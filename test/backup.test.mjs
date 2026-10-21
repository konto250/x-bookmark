import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, parseBackup, restoreBackup } from '../src/backup.js';
import { normalizePost, STORAGE_KEY, readPosts } from '../src/model.js';

const post = (id,extra={}) => normalizePost({url:`https://x.com/test/status/${id}`,text:'本文 #開発',tags:['開発','学習'],excludedTags:['資料'],author:'投稿者',links:['https://example.com/'],pages:[{url:'https://example.com/',title:'資料',description:'説明',status:'ok'}],createdAt:1700000000000,updatedAt:1700000000100,...extra});
const storage = (posts=[]) => {const entries=new Map([[STORAGE_KEY,JSON.stringify(posts)]]);return {getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};};

test('全フィールドをバックアップし、空の保存領域へ同じ内容を復元する',()=>{
  const posts=[post(1),post(2,{text:'二つ目',tags:[]})];
  const exported=createBackup(posts,new Date('2026-10-21T00:00:00Z'));
  const s=storage();restoreBackup(parseBackup(JSON.stringify(exported)),'merge',s);
  assert.deepEqual(readPosts(s),posts);assert.equal(exported.version,1);
  assert.deepEqual(Object.keys(exported),['app','version','exportedAt','bookmarks']);
});
test('追加復元は既存を残し、重複の本文・タグを更新して最初の保存日を維持する',()=>{
  const original=post(1),s=storage([original,post(2)]);
  const incoming=post(1,{text:'復元した本文',tags:['復元タグ'],createdAt:1800000000000});
  restoreBackup([incoming,post(3)],'merge',s);
  const rows=readPosts(s);assert.equal(rows.length,3);assert.equal(rows[0].text,'復元した本文');assert.deepEqual(rows[0].tags,['復元タグ']);assert.equal(rows[0].createdAt,original.createdAt);
});
test('置き換え復元はバックアップの状態に戻し、空のバックアップも復元できる',()=>{
  const s=storage([post(1)]);restoreBackup([post(2)],'replace',s);assert.deepEqual(readPosts(s),[post(2)]);
  restoreBackup([],'replace',s);assert.deepEqual(readPosts(s),[]);
});
test('従来のバージョン1・配列形式・BOM付きJSONに対応し重複をまとめる',()=>{
  const p=post(1);assert.deepEqual(parseBackup(JSON.stringify({version:1,bookmarks:[p]})),[p]);
  assert.deepEqual(parseBackup('\uFEFF'+JSON.stringify([p,p])),[p]);
});
test('破損ファイル・未知の形式・一部の不正データは全体を拒否する',()=>{
  for(const data of ['{','null','{}',JSON.stringify({version:2,bookmarks:[]}),JSON.stringify({app:'other',version:1,bookmarks:[]}),JSON.stringify([post(1),{url:'javascript:alert(1)'}]),JSON.stringify([post(1,{}) ,{...post(2),tags:'タグ'}])]) assert.throws(()=>parseBackup(data));
});
test('保存容量不足や不正な復元方法で既存データを消さない',()=>{
  const s=storage([post(1)]),before=s.getItem(STORAGE_KEY);
  s.setItem=()=>{throw new DOMException('容量不足','QuotaExceededError');};
  for(const mode of ['merge','replace','unknown']) {assert.throws(()=>restoreBackup([post(2)],mode,s));assert.equal(s.getItem(STORAGE_KEY),before);}
});
test('壊れた既存保存領域でも置き換えで復旧できる',()=>{
  const s=storage();s.setItem(STORAGE_KEY,'{');assert.throws(()=>restoreBackup([post(1)],'merge',s));
  restoreBackup([post(1)],'replace',s);assert.deepEqual(readPosts(s),[post(1)]);
});
