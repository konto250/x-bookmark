import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { postUrl, normalizePost, normalizeTags, extractHashtags, readPosts, upsertPosts, extractUrls, STORAGE_KEY } from '../src/model.js';
import { isPublicAddress, validateTarget, parsePage } from '../server/pages.js';
import { proposeTags } from '../server/llm.js';
import { sessionCookie, authenticated, validAccessCode } from '../server/auth.js';
import { buildBookmarklet } from '../src/bookmarklet.js';
import handler from '../api/analyze.js';

const fixture = {url:'https://x.com/test/status/12345',text:'AIによる開発',tags:['AI'],createdAt:100,updatedAt:100};
function memoryStorage() {const data=new Map();return {getItem:k=>data.get(k) || null,setItem:(k,v)=>data.set(k,v)};}

test('ポストURLを正規化し、偽装ドメインやスクリプトを拒否する',()=>{
  assert.equal(postUrl('https://twitter.com/user/status/123/photo/1?s=20'),'https://x.com/user/status/123');
  assert.equal(postUrl('https://x.com/i/web/status/123'),'https://x.com/i/web/status/123');
  for(const url of ['javascript:alert(1)','https://x.com.evil.test/user/status/123','https://x.com/home','file://x.com/user/status/123']) assert.equal(postUrl(url),null);
});
test('タグの空白・重複・長さを正規化する',()=>{assert.deepEqual(normalizeTags([' #AI','AI','',null,'開発']),['AI','開発']);assert.equal(normalizeTags(['あ'.repeat(60)])[0].length,40);});
test('本文から日本語・英数字・全角ハッシュタグを重複なく取り込む',()=>{assert.deepEqual(extractHashtags('勉強中 #TypeScript #開発 ＃VR_3D #開発\n#学習2026'),['TypeScript','開発','VR_3D','学習2026']);});
test('URL内のフラグメントとハッシュ記号だけの文字列はタグにしない',()=>{assert.deepEqual(extractHashtags('https://example.com/docs#section https://example.org/?x=#ignored # ＃ #読む'),['読む']);assert.deepEqual(extractHashtags('ハッシュタグなし'),[]);});
test('同じポストの再保存は重複せず最初の保存日を維持する',()=>{const s=memoryStorage();upsertPosts([fixture],s);upsertPosts([{...fixture,tags:['開発'],createdAt:500}],s);assert.equal(readPosts(s).length,1);assert.deepEqual(readPosts(s)[0].tags,['開発']);assert.equal(readPosts(s)[0].createdAt,100);});
test('別タブで保存した最新データを消さずに追記する',()=>{const s=memoryStorage();upsertPosts([fixture],s);upsertPosts([{...fixture,url:'https://x.com/other/status/999'}],s);assert.equal(readPosts(s).length,2);});
test('壊れた保存データは上書きしない',()=>{const s=memoryStorage();s.setItem(STORAGE_KEY,'broken');assert.throws(()=>upsertPosts([fixture],s));assert.equal(s.getItem(STORAGE_KEY),'broken');});
test('容量エラーは保存失敗として返す',()=>{const s={getItem:()=>null,setItem:()=>{throw new Error('容量不足');}};assert.throws(()=>upsertPosts([fixture],s),/容量不足/);});
test('取り込み時に危険なリンクを除外する',()=>{const p=normalizePost({...fixture,links:['javascript:alert(1)','https://example.com'],pages:[{url:'data:text/html,<script/>',status:'ok'}]});assert.deepEqual(p.links,['https://example.com/']);assert.equal(p.pages.length,0);});
test('本文からURLを抽出する',()=>{assert.deepEqual(extractUrls('参考 https://example.com/docs。こちら https://example.org/x'),['https://example.com/docs','https://example.org/x']);});
test('内部IP・IPv4マップIPv6・予約IPを拒否する',()=>{for(const ip of ['127.0.0.1','10.0.0.1','192.168.0.1','172.16.0.1','169.254.169.254','0.0.0.0','::1','::ffff:127.0.0.1','fc00::1','fe80::1','100.64.0.1'])assert.equal(isPublicAddress(ip),false,ip);assert.equal(isPublicAddress('1.1.1.1'),true);});
test('DNSに内部IPが混ざっていても取得しない',async()=>{await assert.rejects(validateTarget('https://example.com',async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]),/公開ページ/);});
test('認証付きURL・特殊ポート・非HTTPを拒否する',async()=>{for(const url of ['http://localhost/','ftp://example.com','https://user:pass@example.com','https://example.com:8080'])await assert.rejects(validateTarget(url));});
test('リンク先HTMLからタイトル・説明・本文を抽出しスクリプトを除く',()=>{const p=parsePage('<html><head><title>見出し</title><meta name="description" content="説明"></head><body><nav>ナビ</nav><article>Reactの解説<script>危険な命令</script></article></body></html>','https://example.com');assert.equal(p.title,'見出し');assert.equal(p.description,'説明');assert.equal(p.text,'Reactの解説');});
test('LLMへ本文と取得済みページだけを送り構造化されたタグを受け取る',async()=>{let sent;const result=await proposeTags({text:'ポスト',pages:[{status:'ok',url:'https://example.com',title:'タイトル',text:'内容'},{status:'error',url:'https://bad.test'}],existingTags:['開発']},{apiKey:'test-key',fetcher:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(init.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({tags:['AI','開発','AI'],summary:'内容に基づき提案しました。'})}]}]})};}});assert.equal(sent.store,false);assert.equal(sent.text.format.type,'json_schema');assert.equal(JSON.parse(sent.input).pages.length,1);assert.deepEqual(result.tags,['AI','開発']);});
test('OpenAIの利用上限や不正な応答を成功扱いしない',async()=>{await assert.rejects(proposeTags({text:'',pages:[],existingTags:[]},{apiKey:'test-key',fetcher:async()=>({ok:false,status:429})}),/利用上限/);await assert.rejects(proposeTags({text:'',pages:[],existingTags:[]},{apiKey:'test-key',fetcher:async()=>({ok:true,json:async()=>({status:'incomplete'})})}),/完了できません/);});
test('LLMに自動取り込み済みハッシュタグを伝え、追加のタグだけを返す',async()=>{
  let sent;
  const result=await proposeTags({text:'ReactでWebアプリを作る #React #開発',pages:[],existingTags:[]},{apiKey:'test-key',fetcher:async(_url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({tags:['React','開発','Webアプリ','チュートリアル'],summary:'テーマを補います。'})}]}]})};}});
  assert.deepEqual(JSON.parse(sent.input).hashtags,['React','開発']);assert.deepEqual(result.tags,['Webアプリ','チュートリアル']);
});
test('認証Cookieの改ざん・期限切れ・秘密鍵変更を拒否する',()=>{const now=1700000000000;const cookie=sessionCookie('secret',true,now);assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.match(cookie,/Secure/);const req={headers:{cookie}};assert.equal(authenticated(req,'secret',now),true);assert.equal(authenticated(req,'other',now),false);assert.equal(authenticated(req,'secret',now+31*86400000),false);assert.equal(authenticated({headers:{cookie:cookie.replace(/\.[a-f0-9]+;/,'.bad;')}},'secret',now),false);assert.equal(validAccessCode('secret','secret'),true);assert.equal(validAccessCode('wrong','secret'),false);});
test('ブックマークレットは詳細のポストを選択してURLフラグメントで送る',()=>{
  const dom=new JSDOM('<article data-testid="tweet"><a href="/test/status/999"><time>昨日</time></a><div data-testid="tweetText">別の本文</div></article><article data-testid="tweet"><div data-testid="User-Name">テスト</div><a href="/test/status/123"><time>今日</time></a><div data-testid="tweetText">本文</div></article>',{url:'https://x.com/test/status/123',runScripts:'outside-only'});
  let opened;dom.window.open=(...args)=>opened=args;dom.window.alert=()=>assert.fail('警告は不要');
  try {dom.window.eval(buildBookmarklet('https://app.example').slice(11));const url=new URL(opened[0]);assert.equal(url.origin,'https://app.example');assert.equal(url.search,'');const payload=JSON.parse(decodeURIComponent(url.hash.slice(9)));assert.equal(payload.url,'https://x.com/test/status/123');assert.equal(payload.text,'本文');assert.equal(opened[2],'noopener,noreferrer');}finally{dom.window.close();}
});
test('ブックマークレットはタイムラインを誤って保存しない',()=>{let alertShown=false;vm.runInNewContext(buildBookmarklet('https://app.example').slice(11),{location:{hostname:'x.com',pathname:'/home'},alert:()=>alertShown=true});assert.equal(alertShown,true);});
test('日時がtime要素ではない詳細ポストでも本文を取得する',()=>{
  const dom = new JSDOM('<article data-testid="tweet"><div data-testid="User-Name">投稿者</div><div data-testid="tweetText">詳細ページの本文</div><a href="/test/status/123">午後3:00 · 2026年10月21日</a></article><article data-testid="tweet"><a href="/reply/status/999"><time>1分</time></a><div data-testid="tweetText">返信の本文</div></article>', {url:'https://x.com/test/status/123',runScripts:'outside-only'});
  let opened, warning;
  dom.window.open=(...args)=>opened=args;dom.window.alert=message=>warning=message;
  try {
    dom.window.eval(buildBookmarklet('https://app.example').slice(11));
    assert.ok(opened,warning || '保存画面が開くこと');
    const payload=JSON.parse(decodeURIComponent(new URL(opened[0]).hash.slice(9)));
    assert.equal(payload.text,'詳細ページの本文');
  } finally {dom.window.close();}
});
test('API未設定・未認証・不正な送信元を適切に拒否する',async()=>{
  const priorKey=process.env.OPENAI_API_KEY,priorToken=process.env.APP_ACCESS_TOKEN;
  const run=async(req)=>{let body;const res={setHeader(){},end(data){body=JSON.parse(data);},statusCode:200};await handler({method:'POST',headers:{host:'app.example','content-type':'application/json'},body:fixture,...req},res);return {code:res.statusCode,body};};
  try {delete process.env.OPENAI_API_KEY;delete process.env.APP_ACCESS_TOKEN;assert.equal((await run({})).code,503);process.env.OPENAI_API_KEY='test';process.env.APP_ACCESS_TOKEN='secret';assert.equal((await run({})).code,401);assert.equal((await run({headers:{host:'app.example',origin:'https://evil.example'}})).code,403);assert.equal((await run({body:{action:'authenticate',accessCode:'wrong'}})).code,401);assert.equal((await run({body:{action:'authenticate',accessCode:'secret'}})).code,200);}finally{if(priorKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=priorKey;if(priorToken===undefined)delete process.env.APP_ACCESS_TOKEN;else process.env.APP_ACCESS_TOKEN=priorToken;}
});
