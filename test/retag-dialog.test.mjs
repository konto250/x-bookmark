import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { normalizePost, readPosts, STORAGE_KEY } from '../src/model.js';
import { createRetagDialog } from '../src/retag-dialog.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const post=id=>normalizePost({url:`https://x.com/test/status/${id}`,text:`ポスト${id} #開発`,tags:['旧分類'],createdAt:id,updatedAt:id});
function fixture({analyze=async()=>({tags:['新分類'],pages:[]}),confirm=()=>true}={}) {
  const dom=new JSDOM('<div id="app"></div>',{url:'https://postnote.test'}),w=dom.window;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.localStorage.setItem(STORAGE_KEY,JSON.stringify([post(1),post(2)]));
  let calls=0,saved=0;
  const dialog=createRetagDialog({document:w.document,storage:()=>w.localStorage,analyze:async(...args)=>{calls++;return analyze(...args);},onSaved:()=>{saved++;},confirm});
  const $=s=>w.document.querySelector(s);
  dialog.open();
  return {dom,w,dialog,$,calls:()=>calls,saved:()=>saved,click:s=>$(s).click(),posts:()=>readPosts(w.localStorage)};
}
test('対象選択・差分確認・適用・元に戻すまで、確認前のデータを変更しない',async()=>{
  const f=fixture();try {
    assert.equal(f.calls(),0);assert.equal(f.$('#retag-run').disabled,true);
    f.click('[data-retag-select="1"]');f.click('#retag-run');await tick();
    assert.equal(f.calls(),1);assert.deepEqual(f.posts(),[post(1),post(2)]);
    const row=f.$('[data-retag-select="1"]').closest('article').textContent;
    assert.match(row,/変更前旧分類/);assert.match(row,/変更後開発 \/ 新分類/);assert.match(row,/削除旧分類/);
    f.click('#retag-apply');assert.equal(f.saved(),1);assert.equal(f.$('#retag').open,false);
    assert.deepEqual(f.posts()[0].tags,['開発','新分類']);assert.deepEqual(f.posts()[1],post(2));
    f.dialog.open();f.click('#retag-undo');assert.deepEqual(f.posts(),[post(1),post(2)]);assert.equal(f.calls(),1);
  } finally {f.dom.window.close();}
});
test('元のタグも残す選択は追加のみになり、確認を取り消したら保存しない',async()=>{
  const f=fixture({confirm:()=>false});try {
    f.click('[data-retag-select="1"]');f.click('#retag-run');await tick();f.click('#retag-keep');
    assert.match(f.$('[data-retag-select="1"]').closest('article').textContent,/変更後旧分類 \/ 開発 \/ 新分類/);
    f.click('#retag-apply');assert.equal(f.saved(),0);assert.deepEqual(f.posts(),[post(1),post(2)]);
  } finally {f.dom.window.close();}
});
test('途中で解析が失敗したら止まり、成功分だけを適用できる',async()=>{
  const f=fixture({analyze:async post=>{if(post.id==='1')throw new Error('通信失敗');return {tags:['新分類'],pages:[]};}});try {
    f.click('#retag-all');f.click('#retag-run');await tick();
    assert.match(f.$('#retag-error').textContent,/通信失敗/);assert.equal(f.calls(),2);assert.deepEqual(f.posts(),[post(1),post(2)]);
    f.click('#retag-apply');assert.deepEqual(f.posts()[0],post(1));assert.deepEqual(f.posts()[1].tags,['開発','新分類']);
  } finally {f.dom.window.close();}
});
test('中止後に遅れて届いた提案は採用せず、後続ポストも解析しない',async()=>{
  let resolve,signal;
  const f=fixture({analyze:(post,context)=>{signal=context.signal;return new Promise(done=>{resolve=done;});}});try {
    f.click('#retag-all');f.click('#retag-run');await tick();f.click('#retag-stop');assert.equal(signal.aborted,true);
    resolve({tags:['遅い提案'],pages:[]});await tick();assert.equal(f.calls(),1);assert.equal(f.$('#retag-apply').disabled,true);
    assert.doesNotMatch(f.$('#retag-list').textContent,/遅い提案/);assert.deepEqual(f.posts(),[post(1),post(2)]);
  } finally {f.dom.window.close();}
});
test('適用前に対象のチェックを外したら、解析済みでもそのポストを変更しない',async()=>{
  const f=fixture();try {
    f.click('#retag-all');f.click('#retag-run');await tick();f.click('[data-retag-select="2"]');f.click('#retag-apply');
    assert.deepEqual(f.posts()[0].tags,['開発','新分類']);assert.deepEqual(f.posts()[1],post(2));
  } finally {f.dom.window.close();}
});
