import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createAnalysisCache, ANALYSIS_CACHE_KEY, CACHE_TTL } from '../src/analysis-cache.js';
import { normalizePost } from '../src/model.js';
import { proposeTags } from '../server/llm.js';
import { DEFAULT_MODEL, INPUT_LIMITS } from '../src/analysis-config.js';

const post = normalizePost({url:'https://x.com/test/status/1', text:'本文 #開発', links:['https://example.com/']});
const result = {tags:['学習'], pages:[{url:'https://example.com/',title:'資料',status:'ok'}]};
function fixture() {
  const values = new Map();
  const storage = {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  let time = 100000;
  const options = {storage:()=>storage,crypto:webcrypto,now:()=>time};
  return {cache:createAnalysisCache(options), options, storage, advance:n=>time+=n};
}
test('別インスタンスで結果を再利用し、30日経過後は再取得する',async()=>{
  const f=fixture(), key=await f.cache.key(post,DEFAULT_MODEL);
  f.cache.put(key,result,post);
  assert.deepEqual(createAnalysisCache(f.options).get(key,post).tags,['学習']);
  f.advance(CACHE_TTL-1);assert.ok(f.cache.get(key,post));
  f.advance(1);assert.equal(f.cache.get(key,post),null);
});
test('本文・リンク順序・モデル・解析仕様の変更で別の結果として扱う',async()=>{
  const {cache}=fixture(), key=await cache.key(post,DEFAULT_MODEL);
  for(const changed of [{...post,text:post.text+'変更'},{...post,links:['https://other.test/']},{...post,url:'https://x.com/test/status/2'}]) assert.notEqual(await cache.key(changed,DEFAULT_MODEL),key);
  assert.notEqual(await cache.key(post,'別モデル'),key);
  assert.notEqual(await cache.key(post,DEFAULT_MODEL,'新仕様'),key);
  assert.equal(await cache.key({...post,tags:['追加タグ']},DEFAULT_MODEL),key);
  assert.notEqual(await cache.key({...post,links:['https://a.test','https://b.test']},DEFAULT_MODEL),await cache.key({...post,links:['https://b.test','https://a.test']},DEFAULT_MODEL));
});
test('壊れたキャッシュや容量不足でも解析結果を利用できる',async()=>{
  const f=fixture();f.storage.setItem(ANALYSIS_CACHE_KEY,'{壊れたJSON');assert.equal(f.cache.get('key',post),null);
  const cache=createAnalysisCache({storage:()=>{throw new Error('保存不可');},crypto:webcrypto});
  assert.doesNotThrow(()=>cache.put('key',result,post));assert.equal(cache.get('key',post),null);
});
test('キャッシュは最大100件に抑え、危険なリンクを保存しない',()=>{
  const f=fixture();
  for(let i=0;i<110;i++)f.cache.put(String(i),{...result,pages:[{url:'javascript:alert(1)'}]},post);
  assert.equal(JSON.parse(f.storage.getItem(ANALYSIS_CACHE_KEY)).length,100);
  assert.equal(f.cache.get('0',post),null);assert.deepEqual(f.cache.get('109',post).pages,[]);
});
test('AI入力を制限し、推論と説明文生成を省いてタグだけを要求する',async()=>{
  let sent;
  await proposeTags({text:'長'.repeat(30000)+' #末尾タグ',pages:Array.from({length:10},()=>({status:'ok',url:'https://example.com/'+ 'a'.repeat(2000),title:'題'.repeat(300),description:'説'.repeat(500),text:'文'.repeat(10000)})),existingTags:Array.from({length:30},(_,i)=>'タグ'+i)}, {apiKey:'テスト',model:DEFAULT_MODEL,fetcher:async(_url,init)=>{
    sent=JSON.parse(init.body);
    return {ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({tags:['資料']})}]}]})};
  }});
  const input=JSON.parse(sent.input);
  assert.equal(input.post.length,INPUT_LIMITS.post);assert.equal(input.pages.length,5);
  for(const page of input.pages) {assert.ok(page.text.length<=1000);assert.ok(page.title.length<=160);assert.ok(page.description.length<=240);assert.ok(page.url.length<=500);}
  assert.deepEqual(input.hashtags,['末尾タグ']);assert.equal(input.existingTags.length,30);
  assert.equal(sent.max_output_tokens,256);assert.deepEqual(sent.reasoning,{effort:'none'});
  assert.deepEqual(sent.text.format.schema.required,['tags']);assert.equal(sent.text.format.schema.properties.summary,undefined);
});
