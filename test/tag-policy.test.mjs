import test from 'node:test';
import assert from 'node:assert/strict';
import { existingTagsByUsage, normalizeTagCatalog, preferExistingTags } from '../src/tag-policy.js';
import { selectExistingTags } from '../server/tag-candidates.js';
import { proposeTags } from '../server/llm.js';
import { sessionCookie } from '../server/auth.js';
import handler from '../api/analyze.js';

test('既存タグは使用頻度順に並べ、30件を超えるタグも候補として保持する',()=>{
  const tags=Array.from({length:100},(_,i)=>'分類'+i);
  const catalog=existingTagsByUsage([...tags.map(tag=>({tags:[tag]})),{tags:['分類99']}]);
  assert.equal(catalog.length,100);assert.equal(catalog[0],'分類99');
  assert.deepEqual(normalizeTagCatalog(['React','react','Ｒｅａｃｔ','開発']),['React','開発']);
});
test('候補の後ろにある関連タグを拾い、件数と文字数の上限を守る',()=>{
  const tags=[...Array.from({length:80},(_,i)=>'未関連'+i),'TypeScript','型システム'];
  const chosen=selectExistingTags(tags,'TypeScriptの入門',[{title:'型システムの解説'}]);
  assert.deepEqual(chosen.slice(0,2),['TypeScript','型システム']);assert.equal(chosen.length,40);
  const long=selectExistingTags(Array.from({length:80},(_,i)=>'長'.repeat(38)+i),'',[]);
  assert.ok(long.reduce((n,t)=>n+t.length,0)<=1200);
});
test('AIタグの表記だけを既存に合わせ、別の技術名や必要な新規タグは残す',()=>{
  assert.deepEqual(preferExistingTags(['react','ＲＥＡＣＴ','C++','C#','旅行'],['React','C++','C#']),['React','C++','C#','旅行']);
});
test('AIの表記揺れを補正し、本文ハッシュタグと同じ内容は追加しない',async()=>{
  const result=await proposeTags({text:'開発 #React',pages:[],existingTags:['React','TypeScript']},{apiKey:'test',fetcher:async()=>({ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({tags:['react','typescript','旅行']})}]}]})})});
  assert.deepEqual(result.tags,['TypeScript','旅行']);
});
test('APIからLLMまで31件目以降の関連タグを落とさず渡す',async()=>{
  const before={key:process.env.OPENAI_API_KEY,token:process.env.APP_ACCESS_TOKEN,fetch:globalThis.fetch};let sent,answer;
  try {
    process.env.OPENAI_API_KEY='test';process.env.APP_ACCESS_TOKEN='test-secret';
    globalThis.fetch=async(_url,init)=>{sent=JSON.parse(init.body);return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{"tags":["TypeScript"]}'}]}]})};};
    const res={setHeader(){},statusCode:200,end(body){answer=JSON.parse(body);}};
    await handler({method:'POST',headers:{host:'app.example','content-type':'application/json',cookie:sessionCookie('test-secret')},body:{url:'https://x.com/test/status/123',text:'TypeScriptを学ぶ',existingTags:[...Array.from({length:80},(_,i)=>'分類'+i),'TypeScript']}},res);
    assert.equal(res.statusCode,200);assert.ok(JSON.parse(sent.input).existingTags.includes('TypeScript'));assert.deepEqual(answer.tags,['TypeScript']);
  }finally{globalThis.fetch=before.fetch;for(const [name,value] of [['OPENAI_API_KEY',before.key],['APP_ACCESS_TOKEN',before.token]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
