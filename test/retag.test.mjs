import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePost, readPosts, STORAGE_KEY } from '../src/model.js';
import { proposedRetag, applyRetags, undoRetags, RETAG_UNDO_KEY } from '../src/retag.js';
import { createSavedPostAnalyzer } from '../src/retag-analysis.js';

const post=(id,tags=['古いタグ'])=>normalizePost({url:`https://x.com/test/status/${id}`,text:'本文 #開発 #除外',tags,excludedTags:['除外'],createdAt:100,updatedAt:200});
function fixture(posts=[post(1),post(2)]) {
  const values=new Map([[STORAGE_KEY,JSON.stringify(posts)]]);
  const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  return {storage,posts};
}

test('付け直しはハッシュタグと既存表記を使い、外したタグを再追加しない',()=>{
  assert.deepEqual(proposedRetag(post(1),['react','開発','除外'],['React']),['開発','React']);
  assert.deepEqual(proposedRetag(post(1),['react'],['React'],true),['古いタグ','開発','React']);
  const full=post(1,Array.from({length:30},(_,i)=>`元${i}`));
  assert.deepEqual(proposedRetag(full,['新規'],[],true),full.tags);
});
test('選択分だけ適用し、本文・除外タグ・保存日時と他ポストの変更を残す',()=>{
  const {storage,posts}=fixture();
  const other={...posts[1],text:'別タブでの変更'};storage.setItem(STORAGE_KEY,JSON.stringify([posts[0],other,post(3)]));
  const result=applyRetags([{before:posts[0],tags:['開発','React']}],storage,300);
  assert.equal(result.count,1);assert.deepEqual(result.posts,[{...posts[0],tags:['開発','React'],updatedAt:300},other,post(3)]);
  assert.deepEqual(undoRetags(storage).posts,[posts[0],other,post(3)]);
  assert.equal(storage.getItem(RETAG_UNDO_KEY),null);
});
test('変更がない場合は保存せず、直前の元に戻す履歴を保持する',()=>{
  const {storage,posts}=fixture();storage.setItem(RETAG_UNDO_KEY,'以前の履歴');
  assert.equal(applyRetags([{before:posts[0],tags:posts[0].tags}],storage).count,0);
  assert.equal(storage.getItem(RETAG_UNDO_KEY),'以前の履歴');
});
test('解析後に対象が変更・削除された場合は全件適用を拒否する',()=>{
  for(const deleted of [false,true]) {
    const {storage,posts}=fixture();
    storage.setItem(STORAGE_KEY,JSON.stringify(deleted?[posts[0]]:[posts[0],{...posts[1],tags:['手動変更']}]));
    const before=storage.getItem(STORAGE_KEY);
    assert.throws(()=>applyRetags(posts.map(before=>({before,tags:['新規']})),storage),/解析後に変更/);
    assert.equal(storage.getItem(STORAGE_KEY),before);assert.equal(storage.getItem(RETAG_UNDO_KEY),null);
  }
});
test('付け直し後の手動変更・削除を元に戻す操作で上書きしない',()=>{
  for(const deleted of [false,true]) {
    const {storage,posts}=fixture();applyRetags([{before:posts[0],tags:['新規']}],storage,300);
    storage.setItem(STORAGE_KEY,JSON.stringify(deleted?[posts[1]]:[{...posts[0],tags:['後の手動変更']},posts[1]]));
    const before=storage.getItem(STORAGE_KEY);
    assert.throws(()=>undoRetags(storage),/付け直し後に変更/);assert.equal(storage.getItem(STORAGE_KEY),before);
  }
});
test('付け直し履歴や本体の容量不足では元データを残す',()=>{
  for(const failingKey of [RETAG_UNDO_KEY,STORAGE_KEY]) {
    const {storage,posts}=fixture();storage.setItem(RETAG_UNDO_KEY,'前回の履歴');
    const original=storage.setItem;let failed=false;
    storage.setItem=(key,value)=>{if(key===failingKey&&!failed){failed=true;throw new DOMException('容量不足','QuotaExceededError');}original(key,value);};
    assert.throws(()=>applyRetags([{before:posts[0],tags:['新規']}],storage),{name:'QuotaExceededError'});
    assert.deepEqual(readPosts(storage),posts);assert.equal(storage.getItem(RETAG_UNDO_KEY),'前回の履歴');
  }
});

function analyzerFixture(options={}) {
  let calls=0;const saved=new Map(),sent=[];
  const config={configured:true,authenticated:true,model:'テスト用',analysisVersion:'テスト仕様'};
  const analyze=createSavedPostAnalyzer({getConfig:async()=>config,cache:{key:async p=>p.id,get:k=>saved.get(k),put:(k,v)=>saved.set(k,v)},fetcher:async(url,init)=>{calls++;sent.push(init);return {ok:true,json:async()=>({tags:['開発'],pages:[]})};},onUnauthorized:()=>{},...options});
  return {analyze,saved,sent,config,calls:()=>calls,context:{signal:new AbortController().signal,catalog:['開発','React']}};
}
test('保存済み解析は既存タグを送り、成功キャッシュをAPIなしで再利用する',async()=>{
  const f=analyzerFixture();assert.equal((await f.analyze(post(1),f.context)).reused,false);
  assert.deepEqual(JSON.parse(f.sent[0].body).existingTags,['開発','React']);
  assert.equal((await f.analyze(post(1),f.context)).reused,true);assert.equal(f.calls(),1);
});
test('API呼び出しの待機中に中止したら次のリクエストを送らない',async()=>{
  const f=analyzerFixture();await f.analyze(post(1),f.context);
  const controller=new AbortController();const pending=f.analyze(post(2),{...f.context,signal:controller.signal});
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.calls(),1);controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(f.calls(),1);
});
test('解析エラーはキャッシュせず自動再試行せず、401では画面をロックする',async()=>{
  for(const status of [401,429,502]) {
    let calls=0,locked=false;
    const f=analyzerFixture({fetcher:async()=>{calls++;return {ok:false,status,json:async()=>({error:'テストエラー'})};},onUnauthorized:()=>{locked=true;}});
    await assert.rejects(f.analyze(post(1),f.context));assert.equal(calls,1);assert.equal(f.saved.size,0);assert.equal(locked,status===401);
  }
});
test('別タブとの解析待ち合わせ後にキャッシュを再確認する',async()=>{
  let f;
  f=analyzerFixture({locks:{request:async(name,options,callback)=>{assert.match(name,/postnote-analysis-1/);f.saved.set('1',{tags:['別タブ'],pages:[]});return callback();}}});
  assert.deepEqual((await f.analyze(post(1),f.context)).tags,['別タブ']);assert.equal(f.calls(),0);
});
