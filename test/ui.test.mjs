import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as model from '../src/model.js';
import { buildBookmarklet } from '../src/bookmarklet.js';
import { webcrypto } from 'node:crypto';
import { createAnalysisCache, ANALYSIS_CACHE_KEY } from '../src/analysis-cache.js';
import { DEFAULT_MODEL } from '../src/analysis-config.js';
import * as backup from '../src/backup.js';

const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
async function app({posts=[],capture,configured=false,analyze,cache,authenticated=true}={}) {
  const url='https://postnote.test/'+(capture?'#capture='+encodeURIComponent(JSON.stringify(capture)):'');
  const dom=new JSDOM('<div id="app"></div><div id="toast"></div>',{url,runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  Object.assign(w,model,{readPosts:()=>model.readPosts(w.localStorage),upsertPosts:incoming=>model.upsertPosts(incoming,w.localStorage),buildBookmarklet});
  Object.assign(w,{DEFAULT_MODEL,createAnalysisCache:options=>createAnalysisCache({...options,crypto:webcrypto})});
  Object.assign(w,backup,{restoreBackup:(posts,mode)=>backup.restoreBackup(posts,mode,w.localStorage)});
  if(cache) w.localStorage.setItem(ANALYSIS_CACHE_KEY,cache);
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.confirm=()=>true;
  w.fetch=async(url,init)=> url === '/api/session' ? {ok:true,json:async()=>({authenticated,configured:true})} : !init ? {ok:true,json:async()=>({configured,authenticated:true,model:'テスト用モック'})} : analyze ? analyze(init) : {ok:false,json:async()=>({error:'AI設定待ち'})};
  if(posts.length)w.localStorage.setItem(model.STORAGE_KEY,JSON.stringify(posts));
  w.eval(source); await tick();
  const $=s=>w.document.querySelector(s);
  const click=s=>{const node=$(s);assert.ok(node,`要素が必要です: ${s}`);node.click();};
  const fill=(s,value)=>{$(s).value=value;$(s).dispatchEvent(new w.Event('input',{bubbles:true}));};
  const submit=()=>$('#editor-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  return {dom,w,$,click,fill,submit};
}
const post=(id,text,tags)=>model.normalizePost({url:`https://x.com/test/status/${id}`,text,tags,author:'テスト\n@test'});

test('未ログイン時は保存済み本文やバックアップ操作を表示しない',async()=>{
  const original=post(1,'非公開の本文',['個人用']);const a=await app({posts:[original],authenticated:false});
  try {assert.equal(a.$('#navigation'),null);assert.equal(a.$('[data-action="backup"]'),null);assert.doesNotMatch(a.$('#app').textContent,/非公開の本文/);assert.match(a.$('#app').textContent,/ログイン/);assert.deepEqual(model.readPosts(a.w.localStorage),[original]);}finally{a.dom.window.close();}
});
test('ログアウトで表示を閉じ、ブックマークを保持して他タブへ通知する',async()=>{
  const original=post(1,'非公開の本文',['個人用']);const a=await app({posts:[original]});
  try {a.click('[data-action="logout"]');await tick();assert.equal(a.$('#navigation'),null);assert.match(a.$('#app').textContent,/ログアウトしました/);assert.deepEqual(model.readPosts(a.w.localStorage),[original]);assert.ok(a.w.localStorage.getItem('postnote.logout'));}finally{a.dom.window.close();}
});
test('別タブでログアウトしたら一覧と開いていた復元画面を閉じる',async()=>{
  const a=await app({posts:[post(1,'非公開の本文',[])]});
  try {a.click('[data-action="backup"]');a.w.dispatchEvent(new a.w.StorageEvent('storage',{key:'postnote.logout',newValue:'1'}));assert.equal(a.$('#backup'),null);assert.equal(a.$('#navigation'),null);assert.doesNotMatch(a.$('#app').textContent,/非公開の本文/);}finally{a.dom.window.close();}
});

async function chooseBackup(a,source,name='バックアップ.json') {
  Object.defineProperty(a.$('#import-file'),'files',{configurable:true,value:[{name,size:source.length,text:async()=>source}]});
  a.$('#import-file').dispatchEvent(new a.w.Event('change',{bubbles:true}));await tick();
}
test('画面から全件をダウンロードし、ファイルを確認して別の保存領域へ復元する',async()=>{
  const posts=[post(1,'開発の本文',['開発']),post(2,'旅行の本文',['旅行'])];
  const a=await app({posts});let exported,filename;
  try {
    a.w.URL.createObjectURL=blob=>{exported=blob;return 'blob:backup';};a.w.URL.revokeObjectURL=()=>{};
    a.w.HTMLAnchorElement.prototype.click=function(){filename=this.download;};
    a.fill('#search','開発');a.click('[data-action="backup"]');a.click('[data-action="export"]');
    assert.match(filename,/^postnote-.*\.json$/);
    const source=await new Promise((resolve,reject)=>{const reader=new a.w.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(exported);});
    assert.equal(JSON.parse(source).bookmarks.length,2);
    const b=await app();try {
      b.click('[data-action="backup"]');await chooseBackup(b,source);
      assert.match(b.$('#restore-preview').textContent,/新規2件/);assert.equal(model.readPosts(b.w.localStorage).length,0);
      b.click('#restore-button');assert.equal(b.$('#backup').open,false);assert.deepEqual(model.readPosts(b.w.localStorage),posts);
      assert.equal(b.w.document.querySelectorAll('.post-card').length,2);
    } finally {b.dom.window.close();}
  } finally {a.dom.window.close();}
});
test('復元のキャンセル・不正ファイルでは変更せず、置き換えは確認後だけ行う',async()=>{
  const original=post(1,'残す本文',['元']),incoming=post(2,'復元した本文',['復元']);
  const a=await app({posts:[original]});
  try {
    a.click('[data-action="backup"]');await chooseBackup(a,JSON.stringify(backup.createBackup([incoming])));
    a.w.confirm=()=>false;a.click('#restore-button');assert.deepEqual(model.readPosts(a.w.localStorage),[original]);
    await chooseBackup(a,'破損データ');assert.equal(a.$('#restore-button').disabled,true);assert.match(a.$('#backup-error').textContent,/JSON/);
    assert.deepEqual(model.readPosts(a.w.localStorage),[original]);
    await chooseBackup(a,JSON.stringify([incoming]),'<img src=x>.json');assert.equal(a.$('#restore-preview img'),null);
    a.fill('#restore-mode','replace');a.$('#restore-mode').dispatchEvent(new a.w.Event('change'));
    a.w.confirm=message=>{assert.match(message,/すべて削除/);return true;};a.click('#restore-button');
    assert.deepEqual(model.readPosts(a.w.localStorage),[incoming]);
  } finally {a.dom.window.close();}
});

test('同じ内容はAPIを再呼び出しせず、再取り込みでも削除タグを戻さない。明示的な再解析と本文変更時はAPIを呼ぶ',async()=>{
  let calls=0;
  const capture={url:'https://x.com/test/status/123',text:'型を学ぶ #TypeScript'};
  const analyze=async()=>{calls++;return {ok:true,json:async()=>({tags:['学習','開発'],pages:[]})};};
  const a=await app({capture,configured:true,analyze});
  try {
    await tick();assert.equal(calls,1);
    a.click('[data-remove-tag="学習"]');a.click('#analyze');await tick();
    assert.equal(calls,1);assert.match(a.$('#analysis-status').textContent,/再利用/);assert.equal(a.$('[data-remove-tag="学習"]'),null);
    a.submit();
    const b=await app({capture,configured:true,analyze,posts:model.readPosts(a.w.localStorage),cache:a.w.localStorage.getItem(ANALYSIS_CACHE_KEY)});
    try {
      await tick();assert.equal(calls,1);assert.equal(b.$('[data-remove-tag="学習"]'),null);assert.ok(b.$('[data-remove-tag="TypeScript"]'));
      b.click('#reanalyze');await tick();assert.equal(calls,2);
      b.fill('#post-text','変更した内容 #TypeScript');b.click('#analyze');await tick();assert.equal(calls,3);
    } finally {b.dom.window.close();}
  } finally {a.dom.window.close();}
});
test('AI失敗はキャッシュせず、次の操作で再試行する',async()=>{
  let calls=0;
  const a=await app({capture:{url:'https://x.com/test/status/123',text:'本文'},configured:true,analyze:async()=>{calls++;return calls===1?{ok:false,json:async()=>({error:'通信エラー'})}:{ok:true,json:async()=>({tags:[],pages:[]})};}});
  try {await tick();assert.equal(calls,1);a.click('#analyze');await tick();assert.equal(calls,2);a.click('#analyze');await tick();assert.equal(calls,2);} finally {a.dom.window.close();}
});

test('空の一覧から手動保存、タグ追加、再読み込み、元ポストへのリンク',async()=>{
  const a=await app();try {
    assert.match(a.$('#collection').textContent,/最初の1件/);
    a.click('[data-action="add"]');a.fill('#post-url','https://x.com/test/status/100');a.fill('#post-text','あとで読む本文');a.fill('#tag-input','あとで読む');a.click('#add-tag');a.submit();
    assert.equal(a.$('#editor').open,false);assert.equal(a.$('.post-text').textContent,'あとで読む本文');assert.equal(a.$('.post-link').href,'https://x.com/test/status/100');
    const saved=model.readPosts(a.w.localStorage);assert.deepEqual(saved[0].tags,['あとで読む']);const b=await app({posts:saved});try {assert.equal(b.$('.post-text').textContent,'あとで読む本文');} finally {b.dom.window.close();}
  } finally {a.dom.window.close();}
});
test('タグで絞り込み、本文検索、タグ別グループ表示、タグ編集',async()=>{
  const a=await app({posts:[post(1,'Reactで開発',['開発','React']),post(2,'コーヒーを飲む',['暮らし'])]});try {
    a.click('[data-nav="開発"]');assert.equal(a.w.document.querySelectorAll('.post-card').length,1);assert.match(a.$('.post-text').textContent,/React/);
    a.click('[data-nav="__all"]');a.fill('#search','コーヒー');assert.equal(a.w.document.querySelectorAll('.post-card').length,1);assert.match(a.$('.post-text').textContent,/コーヒー/);
    a.fill('#search','');a.click('#group-button');assert.equal(a.w.document.querySelectorAll('.tag-group').length,3);
    a.click('[data-edit="1"]');a.click('[data-remove-tag="React"]');a.fill('#tag-input','試したい');a.click('#add-tag');a.submit();assert.deepEqual(model.readPosts(a.w.localStorage).find(p=>p.id==='1').tags,['開発','試したい']);
  } finally {a.dom.window.close();}
});
test('ブックマークレットのデータを受け取りフラグメントを消し、LLM提案を編集して保存',async()=>{
  const a=await app({capture:{url:'https://x.com/test/status/123',text:'Reactのドキュメント https://react.dev'},configured:true,analyze:async init=>{assert.match(JSON.parse(init.body).text,/React/);return {ok:true,json:async()=>({tags:['開発','React','学習'],summary:'本文とリンク先から提案しました。',pages:[{url:'https://react.dev/',title:'React',status:'ok'}]})};}});
  try {await tick();assert.equal(a.w.location.hash,'');assert.equal(a.$('#editor').open,true);assert.equal(a.w.document.querySelectorAll('[data-remove-tag]').length,3);assert.match(a.$('#pages').textContent,/取得済み/);a.click('[data-remove-tag="学習"]');a.fill('#tag-input','あとで試す');a.click('#add-tag');a.submit();assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['開発','React','あとで試す']);}finally{a.dom.window.close();}
});
test('LLM失敗後も手動タグで保存でき、エラーを見落とさない',async()=>{
  const a=await app({capture:{url:'https://x.com/test/status/123',text:'本文'},configured:true,analyze:async()=>({ok:false,json:async()=>({error:'OpenAI APIの利用上限に達しました。'})})});
  try {await tick();assert.match(a.$('#analysis-status').textContent,/利用上限/);assert.equal(a.$('#save-post').disabled,false);a.fill('#tag-input','手動タグ');a.click('#add-tag');a.submit();assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['手動タグ']);}finally{a.dom.window.close();}
});
test('取り込んだHTMLは文字として表示し、実行可能な要素を生成しない',async()=>{
  const a=await app({posts:[post(1,'<img src=x onerror=alert(1)>',['<script>'])]});try {assert.equal(a.w.document.querySelectorAll('.post-card img, .post-card script').length,0);assert.match(a.$('.post-text').textContent,/<img/);}finally{a.dom.window.close();}
});
test('削除したポストは保存データからも消える',async()=>{const a=await app({posts:[post(1,'テスト',['テスト'])]});try {a.click('[data-delete="1"]');assert.equal(model.readPosts(a.w.localStorage).length,0);assert.match(a.$('#collection').textContent,/最初の1件/);}finally{a.dom.window.close();}});
test('提案待ちで画面を閉じても、別の下書きを変更しない',async()=>{let resolve;const pending=new Promise(r=>resolve=r);const a=await app({capture:{url:'https://x.com/test/status/123',text:'古い本文'},configured:true,analyze:()=>pending});try {a.$('#editor').close();a.click('[data-action="add"]');a.fill('#post-text','新しい本文');resolve({ok:true,json:async()=>({tags:['古い提案'],pages:[]})});await tick();assert.equal(a.$('#post-text').value,'新しい本文');assert.doesNotMatch(a.$('#draft-tags').textContent,/古い提案/);}finally{a.dom.window.close();}});

test('本文ハッシュタグにAIタグを追加し、同名タグは重複させず保存する',async()=>{
  const a=await app({capture:{url:'https://x.com/test/status/123',text:'Webアプリを作ろう #React ＃開発 #React'},configured:true,analyze:async()=>({ok:true,json:async()=>({tags:['React','学習'],pages:[]})})});
  try {await tick();assert.deepEqual([...a.w.document.querySelectorAll('[data-remove-tag]')].map(el=>el.dataset.removeTag),['React','開発','学習']);a.submit();assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['React','開発','学習']);}finally{a.dom.window.close();}
});
test('AIに失敗しても本文のハッシュタグは取り込んで保存する',async()=>{
  const a=await app({capture:{url:'https://x.com/test/status/123',text:'写真です #写真 #風景'},configured:true,analyze:async()=>({ok:false,json:async()=>({error:'AI接続エラー'})})});
  try {await tick();assert.ok(a.$('[data-remove-tag="写真"]'));a.submit();assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['写真','風景']);}finally{a.dom.window.close();}
});
test('手入力した本文のハッシュタグを保存し、外したタグは再編集でも復活させない',async()=>{
  const a=await app();try {
    a.click('[data-action="add"]');a.fill('#post-url','https://x.com/test/status/123');a.fill('#post-text','勉強中 #Re');a.fill('#post-text','勉強中 #React #学習');a.$('#post-text').dispatchEvent(new a.w.Event('change',{bubbles:true}));
    assert.equal(a.$('[data-remove-tag="Re"]'),null);a.click('[data-remove-tag="学習"]');a.submit();
    assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['React']);
    a.click('[data-edit="123"]');assert.equal(a.$('[data-remove-tag="学習"]'),null);a.submit();assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['React']);
    a.click('[data-edit="123"]');a.fill('#tag-input','学習');a.click('#add-tag');a.submit();assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['React','学習']);
  }finally{a.dom.window.close();}
});
test('提案待ちに外したハッシュタグはAI応答でも保存時にも復活させない',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);
  const a=await app({capture:{url:'https://x.com/test/status/123',text:'制作中 #React #開発'},configured:true,analyze:()=>pending});
  try {a.click('[data-remove-tag="React"]');resolve({ok:true,json:async()=>({tags:['React','ツール'],pages:[]})});await tick();a.submit();assert.deepEqual(model.readPosts(a.w.localStorage)[0].tags,['開発','ツール']);}finally{a.dom.window.close();}
});
