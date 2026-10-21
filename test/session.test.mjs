import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import handler from '../api/session.js';
import { accessResponse, LOGIN_HTML } from '../server/access.js';
import { authenticated, sessionCookie } from '../server/auth.js';
import proxy from '../proxy.js';

const secret='テスト専用の長いランダム文字列相当';
let prior,ip=0;
test.beforeEach(()=>{prior={token:process.env.APP_ACCESS_TOKEN,key:process.env.OPENAI_API_KEY,vercel:process.env.VERCEL};process.env.APP_ACCESS_TOKEN=secret;delete process.env.OPENAI_API_KEY;delete process.env.VERCEL;});
test.afterEach(()=>{for(const [key,value] of Object.entries({APP_ACCESS_TOKEN:prior.token,OPENAI_API_KEY:prior.key,VERCEL:prior.vercel})) if(value===undefined)delete process.env[key];else process.env[key]=value;});
async function request({method='POST',headers={},body={action:'login',password:secret}}={}) {
  const result={code:200,headers:{},body:null};
  const res={setHeader(k,v){result.headers[k]=v;},set statusCode(v){result.code=v;},end(v){result.body=JSON.parse(v);}};
  await handler({method,headers:{host:'app.example',origin:'http://app.example','content-type':'application/json','x-forwarded-for':`test-${++ip}`,...headers},body},res);
  return result;
}
test('APIキー未設定でもログインでき、パスワードを応答に含めずHttpOnly Cookieを発行する',async()=>{
  const r=await request();assert.equal(r.code,200);assert.equal(r.body.authenticated,true);assert.doesNotMatch(JSON.stringify(r),new RegExp(secret));
  assert.match(r.headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000/);
  assert.equal(authenticated({headers:{cookie:r.headers['Set-Cookie']}}),true);assert.match(r.headers['Cache-Control'],/no-store/);
});
test('本番CookieはSecure、ログアウトはCookieを削除する',async()=>{
  process.env.VERCEL='1';
  const r=await request({headers:{origin:'https://app.example'}});assert.equal(r.code,200);assert.match(r.headers['Set-Cookie'],/; Secure/);
  const logout=await request({headers:{origin:'https://app.example'},body:{action:'logout'}});assert.match(logout.headers['Set-Cookie'],/Max-Age=0; Secure/);assert.equal(logout.body.authenticated,false);
});
test('誤ったパスワード・外部Origin・Originなし・不正JSON・大きすぎる入力を拒否する',async()=>{
  assert.equal((await request({body:{action:'login',password:'違う'}})).code,401);
  assert.equal((await request({headers:{origin:'https://evil.example'}})).code,403);
  assert.equal((await request({headers:{origin:undefined}})).code,403);
  assert.equal((await request({headers:{'content-type':'text/plain'}})).code,415);
  assert.equal((await request({body:'{' })).code,400);
  assert.equal((await request({body:'a'.repeat(4097)})).code,413);
});
test('同じIPからのログイン試行は1分あたり5回まで',async()=>{
  for(let i=0;i<5;i++)assert.equal((await request({headers:{'x-forwarded-for':'rate-test'},body:{action:'login',password:'違う'}})).code,401);
  const r=await request({headers:{'x-forwarded-for':'rate-test'}});assert.equal(r.code,429);assert.equal(r.headers['Retry-After'],'60');
});
test('パスワード未設定ではログインを許可しない',async()=>{
  delete process.env.APP_ACCESS_TOKEN;assert.equal((await request()).code,503);
  assert.equal((await request({method:'GET'})).body.authenticated,false);
});
test('未認証にはログイン画面だけを返し、アプリ本体・API・別パスを拒否する',async()=>{
  const page=accessResponse(new Request('https://app.example/'));assert.equal(page.status,200);assert.match(await page.text(),/id="login-form"/);assert.match(page.headers.get('cache-control'),/no-store/);
  for(const path of ['/assets/app.js','/api/analyze','/api/analyze?x=1','/other.html','/login.js/extra']) assert.equal(accessResponse(new Request('https://app.example'+path)).status,401);
  for(const path of ['/login.js','/login.css','/api/session']) assert.equal(accessResponse(new Request('https://app.example'+path)),null);
});
test('正しい署名だけがゲートを通り、改ざん・期限切れ・末尾追加は通さない',()=>{
  const cookie=sessionCookie(secret),url='https://app.example/';
  assert.equal(accessResponse(new Request(url,{headers:{cookie}})),null);
  for(const bad of ['postnote_session=true',cookie.replace(/\.[0-9a-f]+;/,'.'+'0'.repeat(64)+';'),sessionCookie(secret,true,Date.now()-31*86400000),cookie.split(';')[0]+'.extra']) assert.ok(accessResponse(new Request(url,{headers:{cookie:bad}})));
  const allowed=proxy(new Request(url,{headers:{cookie}}));assert.equal(allowed.headers.get('x-middleware-next'),'1');assert.match(allowed.headers.get('cache-control'),/no-store/);
});
test('ログインフォームはパスワードを保存せず、取り込みURLを保持して画面を再取得する',async()=>{
  const dom=new JSDOM(LOGIN_HTML,{url:'https://app.example/#capture=sample'});let body,destination;
  try {
    const location={href:'https://app.example/?view=all#capture=sample',replace(url){destination=new URL(url);},reload(){assert.fail('外部からの遷移をreloadしない');}};
    vm.runInNewContext(readFileSync('public/login.js','utf8'),{URL,document:dom.window.document,location,fetch:async(_url,init)=>{if(!init.body)return {ok:true,json:async()=>({authenticated:false})};body=JSON.parse(init.body);return {ok:true,json:async()=>({authenticated:true})};}});
    dom.window.document.querySelector('#password').value=secret;
    dom.window.document.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(body.password,secret);assert.equal(dom.window.document.querySelector('#password').value,'');assert.equal(destination.origin,'https://app.example');assert.equal(destination.hash,'#capture=sample');assert.equal(destination.searchParams.get('view'),'all');assert.equal(destination.searchParams.get('_postnote_auth'),'1');
    assert.equal(dom.window.localStorage.length,0);assert.equal(dom.window.sessionStorage.length,0);
  }finally{dom.window.close();}
});
test('Xから開いた際も有効なセッションがあればパスワードの再入力なしで進む',async()=>{
  const dom=new JSDOM(LOGIN_HTML);let navigations=0,calls=0;
  try {
    vm.runInNewContext(readFileSync('public/login.js','utf8'),{URL,document:dom.window.document,location:{href:'https://app.example/#capture=sample',replace(url){navigations++;assert.equal(new URL(url).hash,'#capture=sample');assert.equal(new URL(url).searchParams.get('_postnote_auth'),'1');},reload(){assert.fail('自動再読み込みのループを作らない');}},fetch:async(_url,init)=>{calls++;assert.equal(init.credentials,'same-origin');assert.equal(init.body,undefined);return {ok:true,json:async()=>({authenticated:true})};}});
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);assert.equal(navigations,1);
  }finally{dom.window.close();}
});

test('復帰後もログイン画面になった場合は自動遷移を止め、手動ログインで復帰できる',async()=>{
  const dom=new JSDOM(LOGIN_HTML);let destination;
  try {
    vm.runInNewContext(readFileSync('public/login.js','utf8'),{URL,document:dom.window.document,location:{href:'https://app.example/?_postnote_auth=1#capture=sample',replace(url){destination=new URL(url);}},fetch:async()=>({ok:true,json:async()=>({authenticated:true})})});
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(destination,undefined);assert.match(dom.window.document.querySelector('#login-error').textContent,/引き継げませんでした/);
    dom.window.document.querySelector('#password').value=secret;dom.window.document.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,0));assert.equal(destination.searchParams.get('_postnote_auth'),'2');assert.equal(destination.hash,'#capture=sample');
  }finally{dom.window.close();}
});

test('セッションがない場合や確認に失敗した場合は自動遷移しない',async()=>{
  for(const outcome of ['anonymous','network','unauthorized']) {
    const dom=new JSDOM(LOGIN_HTML);let navigations=0;
    try {
      vm.runInNewContext(readFileSync('public/login.js','utf8'),{URL,document:dom.window.document,location:{href:'https://app.example/#capture=sample',replace(){navigations++;}},fetch:async()=>{if(outcome==='network')throw new Error('通信エラー');return {ok:outcome!=='unauthorized',json:async()=>({authenticated:false})};}});
      await new Promise(resolve=>setTimeout(resolve,0));assert.equal(navigations,0);assert.equal(dom.window.document.querySelector('#login-button').disabled,false);
    }finally{dom.window.close();}
  }
});
