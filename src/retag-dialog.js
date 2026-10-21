import { readPosts } from './model.js';
import { existingTagsByUsage } from './tag-policy.js';
import { proposedRetag, applyRetags, undoRetags, RETAG_UNDO_KEY } from './retag.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createRetagDialog({document,storage,analyze,onSaved,confirm}) {
  const dialog=document.createElement('dialog');dialog.id='retag';dialog.setAttribute('aria-labelledby','retag-title');
  dialog.innerHTML=`<div class="dialog-header"><h2 id="retag-title">保存済みタグの付け直し</h2><button type="button" class="icon-button" data-retag-close aria-label="閉じる">×</button></div><div class="dialog-body"><p class="fineprint">現在の既存タグを優先して再分類します。本文のハッシュタグは残し、以前に外したタグは除外します。手動タグとAIタグは区別できないため、削除されるタグを確認してください。</p><div class="retag-controls"><label><input type="checkbox" id="retag-all"> 全件選択</label><label><input type="checkbox" id="retag-keep"> 元のタグも残す（追加のみ）</label></div><p class="fineprint">解析は1件ずつ実行します。利用できるキャッシュは再利用し、それ以外は最大で選択件数分のAPI呼び出しが発生します。解析だけでは保存データは変わりません。</p><div class="retag-controls"><button type="button" id="retag-run" class="secondary">選択したポストを解析する（API使用）</button><button type="button" id="retag-stop" class="secondary" disabled>解析を中止</button></div><p id="retag-status" class="note" role="status" aria-live="polite"></p><p id="retag-error" class="error-message" role="alert"></p><div id="retag-list"></div><p class="fineprint">適用後は直前1回の付け直しを元に戻せます。その後に編集・削除したポストがある場合は、誤って上書きしないよう復元を止めます。</p></div><div class="dialog-footer retag-footer"><button type="button" id="retag-undo" class="secondary">直前の付け直しを元に戻す</button><button type="button" id="retag-apply" class="primary" disabled>確認した変更を適用</button></div>`;
  document.querySelector('#app').append(dialog);
  const $=selector=>dialog.querySelector(selector);
  let rows=[],catalog=[],running=false,controller=null,runId=0;
  const tagsFor=row=>proposedRetag(row.post,row.result.tags,catalog,$('#retag-keep').checked);
  const selected=()=>rows.filter(row=>row.selected);
  function render() {
    const picked=selected();
    $('#retag-all').checked=rows.length>0&&picked.length===rows.length;
    $('#retag-all').indeterminate=picked.length>0&&picked.length<rows.length;
    $('#retag-all').disabled=running;$('#retag-keep').disabled=running;
    $('#retag-run').disabled=running || !picked.some(row=>!row.result);
    $('#retag-stop').disabled=!running;
    $('#retag-apply').disabled=running || !picked.some(row=>row.result);
    try {$('#retag-undo').disabled=running || !storage().getItem(RETAG_UNDO_KEY);} catch {$('#retag-undo').disabled=true;}
    $('#retag-list').innerHTML=rows.map(row=>{
      const next=row.result ? tagsFor(row) : [];
      const removed=row.result ? row.post.tags.filter(tag=>!next.includes(tag)) : [];
      const added=next.filter(tag=>!row.post.tags.includes(tag));
      return `<article class="retag-row"><label class="retag-target"><input type="checkbox" data-retag-select="${row.post.id}" ${row.selected?'checked':''} ${running?'disabled':''}><span>${esc(row.post.text.slice(0,160)||'本文なしのポスト')}</span></label><a class="text-button" href="${esc(row.post.url)}" target="_blank" rel="noopener noreferrer">元のポストを開く</a><dl><dt>変更前</dt><dd>${esc(row.post.tags.join(' / ')||'タグなし')}</dd>${row.result ? `<dt>変更後</dt><dd>${esc(next.join(' / ')||'タグなし')}</dd><dt>追加</dt><dd>${esc(added.join(' / ')||'なし')}</dd><dt>削除</dt><dd class="retag-removed">${esc(removed.join(' / ')||'なし')}</dd>` : ''}</dl><p class="fineprint">${esc(row.message||'未解析')}</p></article>`;
    }).join('') || '<p class="note">保存済みのポストがありません。</p>';
  }
  function stop() {runId++;controller?.abort();running=false;render();}
  async function run() {
    const targets=selected().filter(row=>!row.result);if(running||!targets.length)return;
    running=true;controller=new AbortController();const signal=controller.signal,id=++runId;
    $('#retag-error').textContent='';let done=0,cached=0;render();
    for(const row of targets) {
      if(id!==runId)break;
      $('#retag-status').textContent=`${done}/${targets.length}件完了。次のポストを確認しています…`;
      try {
        const result=await analyze(row.post,{signal,catalog});
        if(id!==runId)break;
        row.result=result;row.message=result.reused?'キャッシュを再利用（API呼び出しなし）':'AI解析済み';
        if(result.pages?.some(page=>page.status!=='ok'))row.message+='。取得できないリンクがあり、利用可能な本文だけで提案しました。';
        if(result.reused)cached++;done++;render();
      } catch(error) {
        if(id!==runId)break;
        row.message=error.message||'解析に失敗しました。';
        $('#retag-error').textContent=`解析を停止しました。${row.message} 完了済みの提案だけを確認・適用できます。`;
        break;
      }
    }
    if(id===runId){running=false;$('#retag-status').textContent=`${done}/${targets.length}件完了（キャッシュ再利用${cached}件）。変更前後を確認し、適用するポストにチェックを入れてください。`;render();}
  }
  $('#retag-all').addEventListener('change',event=>{rows.forEach(row=>row.selected=event.target.checked);render();});
  $('#retag-keep').addEventListener('change',render);
  $('#retag-list').addEventListener('change',event=>{const row=rows.find(row=>row.post.id===event.target.dataset.retagSelect);if(row){row.selected=event.target.checked;render();}});
  $('#retag-run').addEventListener('click',run);
  $('#retag-stop').addEventListener('click',()=>{stop();$('#retag-status').textContent='解析を中止しました。完了済みの提案は確認・適用できます。';});
  $('[data-retag-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',stop);
  $('#retag-apply').addEventListener('click',()=>{
    const changes=selected().filter(row=>row.result).map(row=>({before:row.post,tags:tagsFor(row)}));
    if(running||!changes.length||!confirm(`${changes.length}件のタグを確認した内容に変更します。直前の付け直し履歴は更新されます。適用しますか？`))return;
    try {const result=applyRetags(changes,storage());onSaved(result.posts,`${result.count}件のタグを付け直しました。`);dialog.close();}
    catch(error){$('#retag-error').textContent=error.name==='QuotaExceededError'?'変更前の情報を保存する容量が不足しています。ブックマークは変更していません。':error.message;}
  });
  $('#retag-undo').addEventListener('click',()=>{
    if(running||!confirm('直前の付け直しで変更したタグを元に戻しますか？'))return;
    try {const result=undoRetags(storage());onSaved(result.posts,`${result.count}件のタグを元に戻しました。`);dialog.close();}
    catch(error){$('#retag-error').textContent=error.message;}
  });
  return {
    open(){stop();rows=readPosts(storage()).sort((a,b)=>b.createdAt-a.createdAt).map(post=>({post,selected:false,result:null,message:''}));catalog=existingTagsByUsage(rows.map(row=>row.post));$('#retag-keep').checked=false;$('#retag-status').textContent='対象を選択して解析を開始してください。';$('#retag-error').textContent='';render();dialog.showModal();},
    dispose(){stop();dialog.remove();}
  };
}
