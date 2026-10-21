import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadEnv } from 'vite';
import { inspectPage } from '../server/pages.js';
const base=process.argv[2] || 'http://127.0.0.1:5173';
const env=loadEnv('development',process.cwd(),'');
const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/id="login-form"/);assert.match(page.headers.get('cache-control'),/no-store/);
assert.equal((await fetch(base+'/api/analyze')).status,401);
assert.ok(env.APP_ACCESS_TOKEN,'ローカルにログイン用パスワードが設定されていること');
const headers={'Content-Type':'application/json',Origin:new URL(base).origin};
const wrong=await fetch(base+'/api/session',{method:'POST',headers,body:JSON.stringify({action:'login',password:'不正なテストパスワード'})});assert.equal(wrong.status,401);
const auth=await fetch(base+'/api/session',{method:'POST',headers,body:JSON.stringify({action:'login',password:env.APP_ACCESS_TOKEN})});assert.equal(auth.status,200,'アプリの認証が成功すること');
const setCookie=auth.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=Strict/i);if(base.startsWith('https:'))assert.match(setCookie,/Secure/i);
const cookie=setCookie.split(';')[0];const authorizedHeaders={...headers,Cookie:cookie};
const app=await fetch(base,{headers:authorizedHeaders});assert.equal(app.status,200);const html=await app.text();assert.doesNotMatch(html,/id="login-form"/);
const asset=html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1] || '/src/main.js';
assert.equal((await fetch(base+asset)).status,401);
const assetResponse=await fetch(base+asset,{headers:authorizedHeaders});assert.equal(assetResponse.status,200);
if(process.argv.includes('--local-build')) {
  const builtHtml=readFileSync('dist/index.html','utf8');
  assert.ok(builtHtml.includes(asset),'公開アセットが検証済みのローカルビルドと一致すること');
  assert.equal(await assetResponse.text(),readFileSync('dist'+asset,'utf8'),'公開JavaScriptの内容が検証済みのローカルビルドと一致すること');
  console.log('公開JavaScript: ローカルビルドとの完全一致を確認');
}
assert.equal((await fetch(base+asset)).status,401,'認証済みアセットが匿名アクセスへキャッシュ配信されないこと');
assert.equal((await fetch(base+'/api/analyze',{headers:{Cookie:cookie+'tampered'}})).status,401);
const configResponse=await fetch(base+'/api/analyze',{headers:authorizedHeaders});assert.equal(configResponse.status,200);const config=await configResponse.json();assert.equal(config.authenticated,true);
console.log(JSON.stringify({base,login:'成功',anonymousApi:'拒否',anonymousAssets:'拒否',cookie:'HttpOnly・SameSite確認済み',configured:config.configured}));
const inspected=await inspectPage('https://example.com');console.log(JSON.stringify({linkFetch:inspected.status,title:inspected.title,error:inspected.error}));assert.equal(inspected.status,'ok');
if(env.OPENAI_API_KEY && process.argv.includes('--llm')) {
  const response=await fetch(base+'/api/analyze',{method:'POST',headers:authorizedHeaders,body:JSON.stringify({url:'https://x.com/test/status/1234567890',text:'TypeScriptを学ぶための公式ドキュメント。 #TypeScript #学習 https://www.typescriptlang.org/docs/',links:['https://www.typescriptlang.org/docs/'],existingTags:['開発','学習']})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  assert.ok(result.tags.length);assert.ok(!result.tags.includes('TypeScript') && !result.tags.includes('学習'),'AIが本文ハッシュタグ以外の補足タグを返すこと');assert.ok(result.pages.some(p=>p.status==='ok'),'リンク先の実際の取得成功');console.log(JSON.stringify({authentication:'成功',llm:'成功',...result}));
} else console.log('OpenAI実通信: 未実行（キー未設定、または--llm指定なし）');
const logout=await fetch(base+'/api/session',{method:'POST',headers:authorizedHeaders,body:JSON.stringify({action:'logout'})});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/Max-Age=0/i);
const loggedOut=await fetch(base);assert.match(await loggedOut.text(),/id="login-form"/);console.log('ログアウト: Cookie削除とログイン画面を確認');
