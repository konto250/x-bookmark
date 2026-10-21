import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
import { inspectPage } from '../server/pages.js';
const base=process.argv[2] || 'http://127.0.0.1:5173';
const env=loadEnv('development',process.cwd(),'');
const page=await fetch(base);assert.equal(page.status,200);assert.match(await page.text(),/ポストノート/);
const configResponse=await fetch(base+'/api/analyze');assert.equal(configResponse.status,200);const config=await configResponse.json();
console.log(JSON.stringify({base,http:page.status,api:configResponse.status,configured:config.configured,localKeyConfigured:Boolean(env.OPENAI_API_KEY)}));
const inspected=await inspectPage('https://example.com');console.log(JSON.stringify({linkFetch:inspected.status,title:inspected.title,error:inspected.error}));assert.equal(inspected.status,'ok');
if(env.OPENAI_API_KEY && process.argv.includes('--llm')) {
  const headers={'Content-Type':'application/json',Origin:new URL(base).origin};
  const auth=await fetch(base+'/api/analyze',{method:'POST',headers,body:JSON.stringify({action:'authenticate',accessCode:env.APP_ACCESS_TOKEN})});
  assert.equal(auth.status,200,'アプリの認証が成功すること');
  const cookie=auth.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const response=await fetch(base+'/api/analyze',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({url:'https://x.com/test/status/1234567890',text:'TypeScriptを学ぶための公式ドキュメント。 https://www.typescriptlang.org/docs/',links:['https://www.typescriptlang.org/docs/'],existingTags:['開発','学習']})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  assert.ok(result.tags.length);assert.ok(result.pages.some(p=>p.status==='ok'),'リンク先の実際の取得成功');console.log(JSON.stringify({authentication:'成功',llm:'成功',...result}));
} else console.log('OpenAI実通信: 未実行（キー未設定、または--llm指定なし）');
