import './style.css';
import { STORAGE_KEY, DRAFT_KEY, normalizePost, normalizeTags, extractHashtags, readPosts, upsertPosts } from './model.js';
import { buildBookmarklet } from './bookmarklet.js';
import { DEFAULT_MODEL } from './analysis-config.js';
import { createAnalysisCache } from './analysis-cache.js';

const icons = {
  bookmark: '<path d="M6 4h12v17l-6-4-6 4z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  tag: '<path d="m3 3 8 0 10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r=".8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1 1-1 2M12 17h.01"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  link: '<path d="m10 14 4-4m-6 1-3 3a4 4 0 0 0 5 6l3-3m-2-10 3-3a4 4 0 0 1 6 5l-3 3"/>',
  check: '<path d="m5 12 4 4L19 6"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.bookmark}</svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = s => document.querySelector(s);
const state = {posts: [], filter: null, search: '', grouped: false, sort: 'new', error: '', config: null};
let draft = null, excludedTags = new Set(), analyzing = false, controller = null;
let toastTimer;
const analysisCache = createAnalysisCache({storage: () => localStorage, crypto: window.crypto});
function toast(message) {$('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function loadPosts() {try {state.posts = readPosts(); state.error = '';} catch {state.error = '保存データを読み取れませんでした。ブラウザーの保存設定をご確認ください。既存データは上書きしません。';}}
const allTags = () => [...new Set(state.posts.flatMap(p => p.tags))].sort((a,b)=>a.localeCompare(b,'ja'));
const tagColor = tag => `tag-${[...tag].reduce((sum,c)=>sum+c.codePointAt(0),0)%5}`;
const tagChip = (tag, removable = false) => `<button type="button" class="chip ${tagColor(tag)}" ${removable ? 'data-remove-tag' : 'data-filter'}="${esc(tag)}" ${removable ? `aria-label="${esc(tag)}を外す"` : ''}><span># ${esc(tag)}</span>${removable ? icon('close') : ''}</button>`;
function hasSession() {return Boolean(state.config?.authenticated);}

function renderShell() {
  $('#app').innerHTML = `
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="ポストノート ホーム"><span class="brand-icon">${icon('bookmark')}</span><span>ポストノート<small>見つけたものを、自分の引き出しに。</small></span></a>
      <div class="nav-label">ライブラリー</div><nav id="navigation" aria-label="ブックマークの分類"></nav>
      <div class="sidebar-bottom"><button class="nav-button" data-action="setup">${icon('help')}使い方・ブックマークレット</button><button class="nav-button" data-action="settings">${icon('spark')}AI設定<span id="ai-dot" class="status-dot"></span></button>
      <div class="local-note">${icon('lock')}<span>このブラウザーに保存<small>あなただけのブックマーク</small></span></div></div>
    </aside>
    <main>
      <header class="topbar"><span class="breadcrumb">ライブラリー <span>/</span> <b id="breadcrumb">すべてのポスト</b></span><div class="top-actions"><button class="icon-button" data-action="export" title="バックアップを書き出す" aria-label="バックアップを書き出す">${icon('download')}</button><button class="icon-button" data-action="import" title="バックアップを読み込む" aria-label="バックアップを読み込む">${icon('upload')}</button><span class="avatar">私</span></div></header>
      <div class="main-content"><div class="page-heading"><div><div class="eyebrow">YOUR PERSONAL COLLECTION</div><h1 id="page-title">すべてのポスト</h1><p>また読みたい。あとで試したい。その気持ちを、残しておこう。</p></div><button class="primary" data-action="add">${icon('plus')}ポストを追加</button></div>
      <section class="quickstart"><div class="quickstart-icon">${icon('bookmark')}</div><div><strong>Xで見つけたら、ワンクリック。</strong><p>ブックマークレットで本文を取り込み、AIがタグを提案します。</p></div><button class="secondary" data-action="setup">ブックマークレットを設定 ${icon('arrow')}</button></section>
      <div id="storage-error" role="alert"></div>
      <div class="toolbar"><label class="searchbox">${icon('search')}<input id="search" type="search" placeholder="本文、タグ、ユーザー名から検索" aria-label="ブックマークを検索" /></label><div class="view-options"><button id="group-button" class="secondary" aria-pressed="false">${icon('tag')}タグ別に表示</button><select id="sort" aria-label="並び順"><option value="new">新しく保存した順</option><option value="old">古く保存した順</option><option value="updated">更新した順</option></select></div></div>
      <div class="result-meta"><span id="result-count"></span><span id="filter-summary"></span></div><div id="collection"></div>
      <footer class="page-footer"><span>気になるポストが、あなたの知識になる。</span><span>${icon('lock')} ブラウザー内に保存</span></footer></div>
    </main>
    <input id="import-file" type="file" accept="application/json,.json" hidden />
    <dialog id="editor" aria-labelledby="editor-title"><form id="editor-form"><div class="dialog-header"><div><div class="eyebrow">SAVE A LITTLE INSPIRATION</div><h2 id="editor-title">ポストを保存</h2></div><button type="button" class="icon-button" data-close="editor" aria-label="閉じる">${icon('close')}</button></div>
      <div class="dialog-body"><label class="field">ポストのURL<input id="post-url" type="url" required placeholder="https://x.com/username/status/…" /></label><label class="field">投稿者<input id="post-author" maxlength="160" placeholder="名前・@ユーザー名（任意）" /></label><label class="field">ポストの本文<textarea id="post-text" rows="5" maxlength="30000" placeholder="ポストの本文を入力。ブックマークレットを使うと自動で取り込めます。"></textarea></label>
      <div class="ai-panel"><div class="section-heading"><span>${icon('spark')}AIでタグを提案</span><button id="analyze" type="button" class="small-button">内容を解析する</button></div><p class="fineprint">本文・本文中のリンク先（最大5件）・既存タグをOpenAIへ送って分類します。</p><p id="analysis-status" class="analysis-status" role="status" aria-live="polite"></p><div id="pages"></div></div>
      <div class="field"><span>タグ <small>本文のハッシュタグ＋AI提案・クリックで外せます</small></span><div id="draft-tags" class="tag-list"></div><div class="tag-input-row"><input id="tag-input" maxlength="40" placeholder="タグを自由に追加" aria-label="追加するタグ" /><button type="button" id="add-tag" class="secondary">${icon('plus')}追加</button></div></div><p id="editor-error" class="error-message" role="alert"></p></div>
      <div class="dialog-footer"><span>${icon('lock')} このブラウザーに保存されます</span><button type="submit" id="save-post" class="primary">${icon('bookmark')}保存する</button></div></form></dialog>
    <dialog id="setup" aria-labelledby="setup-title"><div class="dialog-header"><div><div class="eyebrow">SMALL SETUP, BIG COLLECTION</div><h2 id="setup-title">保存を、もっと手軽に。</h2></div><button class="icon-button" data-close="setup" aria-label="閉じる">${icon('close')}</button></div><div class="dialog-body">
      <p class="intro">次のボタンをブラウザーの<strong>ブックマークバーへドラッグ</strong>してください。</p><div class="bookmarklet-zone"><a id="bookmarklet" class="bookmarklet" draggable="true">${icon('bookmark')}ポストノートに保存</a><span>↑ ブックマークバーへドラッグ</span></div>
      <ol class="steps"><li><span>1</span><div><strong>Xでポストの詳細を開く</strong><p>ポストの日時をクリック。長い本文は「さらに表示」で展開します。</p></div></li><li><span>2</span><div><strong>「ポストノートに保存」をクリック</strong><p>新しいタブに本文を取り込み、AI設定済みならタグを提案します。</p></div></li><li><span>3</span><div><strong>タグを整えて、保存</strong><p>いらないタグを外し、好きなタグを追加して、自分の引き出しへ。</p></div></li></ol>
      <details><summary>ドラッグできない場合・スマートフォン</summary><p>ボタンからコードをコピーし、ブラウザーのブックマーク編集画面でURL欄に貼り付けてください。先頭の「javascript:」が残っていることを確認します。実行できない環境では「ポストを追加」からURLと本文を入力できます。</p><button class="secondary" data-action="copy-bookmarklet">コードをコピー</button><textarea id="bookmarklet-code" readonly aria-label="ブックマークレットのコード"></textarea></details>
      <div class="note">本文を取得できない場合は、この画面からブックマークレットを登録し直してください。登録済みのコードは自動更新されません。</div><div class="note">ブックマークはブラウザー・端末・サイトのURLごとに保存されます。データを消す前や別の端末へ移すときは、右上の書き出しボタンでバックアップしてください。</div>
    </div><div class="dialog-footer"><span></span><button class="primary" data-close="setup">はじめる ${icon('arrow')}</button></div></dialog>
    <dialog id="settings" aria-labelledby="settings-title"><form id="settings-form"><div class="dialog-header"><h2 id="settings-title">AIタグ提案の設定</h2><button type="button" class="icon-button" data-close="settings" aria-label="閉じる">${icon('close')}</button></div><div class="dialog-body"><div id="config-status" class="note"></div><label class="field">アプリのアクセスコード<input id="access-code" type="password" autocomplete="off" placeholder="管理者が設定したコード" /></label><p class="fineprint">OpenAIのAPIキーではありません。一度入力すると、このブラウザーで30日間AIタグ提案を利用できます。</p><p id="settings-error" class="error-message" role="alert"></p><details><summary>管理者向け：OpenAI APIの設定方法</summary><p>Vercelのプロジェクト設定で環境変数 <code>OPENAI_API_KEY</code> と、このアプリ専用の長いランダムな <code>APP_ACCESS_TOKEN</code> を設定し、再デプロイしてください。<code>OPENAI_MODEL</code> でモデルを指定できます（初期値：gpt-6-luna）。</p><p>ChatGPTのログインやサブスクリプションではなく、OpenAI APIのキーが必要です。</p></details></div><div class="dialog-footer"><span>OpenAI API</span><button class="primary" type="submit">設定を保存</button></div></form></dialog>`;
  $('#bookmarklet').setAttribute('href', buildBookmarklet(location.origin));
  $('#bookmarklet-code').value = buildBookmarklet(location.origin);
  $('#bookmarklet').addEventListener('click', event => {event.preventDefault(); toast('このボタンをブックマークバーへドラッグしてください。');});
  $('#search').addEventListener('input', event => {state.search = event.target.value; renderCollection();});
  $('#sort').addEventListener('change', event => {state.sort = event.target.value; renderCollection();});
  $('#group-button').addEventListener('click', ()=>{state.grouped = !state.grouped; renderCollection();});
  $('#analyze').addEventListener('click', () => analyzeDraft());
  const refresh = Object.assign(document.createElement('button'), {id:'reanalyze', type:'button', className:'text-button', textContent:'再解析（API使用）', hidden:true});
  refresh.addEventListener('click', () => analyzeDraft({force:true}));
  $('#analyze').after(refresh);
  $('#add-tag').addEventListener('click', addTag);
  $('#tag-input').addEventListener('keydown', event=>{if(event.key === 'Enter'){event.preventDefault(); addTag();}});
  $('#editor-form').addEventListener('submit', saveDraft);
  for (const id of ['post-url','post-author','post-text']) $(`#${id}`).addEventListener('input', persistDraft);
  $('#post-text').addEventListener('change', () => {syncDraft(); applyHashtags(); persistDraft();});
  $('#settings-form').addEventListener('submit', saveSettings);
  $('#import-file').addEventListener('change', importBackup);
  $('#editor').addEventListener('close',()=>{controller?.abort(); analyzing = false; draft = null;});
  document.addEventListener('click', onClick);
}

function renderNavigation() {
  const tags = allTags();
  const nav = (label, count, filter, symbol) => `<button class="nav-button ${state.filter === filter ? 'active' : ''}" data-nav="${esc(filter === null ? '__all' : filter)}" ${state.filter === filter ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${esc(label)}</span><em>${count}</em></button>`;
  $('#navigation').innerHTML = nav('すべてのポスト', state.posts.length, null, 'grid') + nav('タグなし',state.posts.filter(p=>!p.tags.length).length,'__untagged','bookmark') + `<div class="nav-label tags-label">タグ <span>${tags.length}</span></div><div class="tag-navigation">${tags.length ? tags.map(tag=>nav(tag,state.posts.filter(p=>p.tags.includes(tag)).length,tag,'tag')).join('') : '<p class="sidebar-empty">保存したポストのタグが<br>ここに並びます。</p>'}</div>`;
  $('#storage-error').textContent = state.error;
  $('#storage-error').className = state.error ? 'note error-message' : '';
}

function card(post) {
  const date = new Intl.DateTimeFormat('ja-JP',{month:'short',day:'numeric'}).format(post.createdAt);
  const author = post.author.split('\n').filter(Boolean);
  const handle = author.find(s=>s.startsWith('@')) || '@'+post.url.split('/')[3];
  const name = author.find(s=>!s.startsWith('@') && s !== '·') || handle;
  const page = post.pages.find(p=>p.status === 'ok');
  return `<article class="post-card"><div class="post-header"><div class="post-avatar ${tagColor(name)}">${esc([...name.replace('@','')][0] || 'X')}</div><div class="author"><strong>${esc(name)}</strong><span>${esc(handle)}</span></div><span class="x-symbol" aria-label="X">𝕏</span></div><p class="post-text">${esc(post.text || '本文なしのポスト')}</p>${page ? `<a class="link-preview" href="${esc(page.url)}" target="_blank" rel="noopener noreferrer">${icon('link')}<span><strong>${esc(page.title || new URL(page.url).hostname)}</strong><small>${esc(new URL(page.url).hostname)}</small></span>${icon('arrow')}</a>` : ''}<div class="tag-list">${post.tags.map(t=>tagChip(t)).join('') || '<span class="no-tag">タグなし</span>'}</div><div class="card-footer"><time datetime="${new Date(post.createdAt).toISOString()}">${esc(date)}に保存</time><div><button class="icon-button" data-edit="${post.id}" aria-label="ポストを編集" title="編集">${icon('edit')}</button><button class="icon-button delete-button" data-delete="${post.id}" aria-label="ブックマークを削除" title="削除">${icon('trash')}</button><a class="post-link" href="${esc(post.url)}" target="_blank" rel="noopener noreferrer">ポストを開く ${icon('arrow')}</a></div></div></article>`;
}

function renderCollection() {
  const title = state.filter === null ? 'すべてのポスト' : state.filter === '__untagged' ? 'タグなし' : `# ${state.filter}`;
  $('#page-title').textContent = title; $('#breadcrumb').textContent = title;
  const query = state.search.trim().toLocaleLowerCase();
  const posts = state.posts.filter(p => (state.filter === null || (state.filter === '__untagged' ? !p.tags.length : p.tags.includes(state.filter))) && (!query || [p.text,p.author,p.url,...p.tags,...p.pages.map(p=>p.title)].join(' ').toLocaleLowerCase().includes(query))).sort((a,b)=>state.sort === 'old' ? a.createdAt-b.createdAt : state.sort === 'updated' ? b.updatedAt-a.updatedAt : b.createdAt-a.createdAt);
  $('#result-count').innerHTML = `<strong>${posts.length}</strong> 件のポスト`;
  $('#filter-summary').textContent = state.grouped ? '複数のタグがあるポストは各タグに表示されます' : '';
  $('#group-button').setAttribute('aria-pressed',String(state.grouped));
  if (!posts.length) {
    const empty = !state.posts.length && !state.search;
    $('#collection').innerHTML = `<section class="empty-state"><div class="empty-illustration"><span class="paper paper-back"></span><span class="paper paper-front">${icon('bookmark')}<i></i><i></i><i></i></span><span class="tiny-tag"># あとで読む</span><span class="empty-spark">✦</span></div><h2>${empty ? '気になるポストを、最初の1件に。' : '該当するポストがありません'}</h2><p>${empty ? '流れていくタイムラインから、残しておきたいものだけを。<br>タグを添えれば、読み返したいときにすぐ見つかります。' : 'キーワードやタグを変えて、もう一度探してみてください。'}</p><button class="${empty ? 'primary' : 'secondary'}" data-action="${empty ? 'setup' : 'reset'}">${icon(empty ? 'bookmark' : 'search')}${empty ? 'ブックマークレットを設定する' : 'すべてのポストを表示'}</button>${empty ? '<button class="text-button" data-action="add">URLと本文を入力して追加する →</button>' : ''}</section>`;
  } else if (state.grouped) {
    const tags = state.filter && state.filter !== '__untagged' ? [state.filter] : [...new Set(posts.flatMap(p=>p.tags.length ? p.tags : ['__untagged']))].sort((a,b)=>a.localeCompare(b,'ja'));
    $('#collection').innerHTML = tags.map(tag=>{const matches = posts.filter(p=>tag === '__untagged' ? !p.tags.length : p.tags.includes(tag)); return `<section class="tag-group"><h2>${icon('tag')}${esc(tag === '__untagged' ? 'タグなし' : tag)} <span>${matches.length}</span></h2><div class="post-grid">${matches.map(card).join('')}</div></section>`;}).join('');
  } else $('#collection').innerHTML = `<div class="post-grid">${posts.map(card).join('')}</div>`;
}
function renderAll() {renderNavigation(); renderCollection();}

function openEditor(input = {}, edit = false) {
  controller?.abort(); analyzing = false; excludedTags = new Set(normalizeTags(input.excludedTags));
  draft = {url:'',text:'',author:'',links:[],tags:[],pages:[],...input};
  $('#editor-title').textContent = edit ? 'ブックマークを編集' : 'ポストを保存';
  $('#post-url').value = draft.url; $('#post-url').readOnly = edit;
  $('#post-author').value = draft.author; $('#post-text').value = draft.text;
  $('#analysis-status').textContent = ''; $('#editor-error').textContent = '';
  $('#reanalyze').hidden = true;
  $('#tag-input').value = ''; setAnalyzing(false); applyHashtags(); renderPages();
  if (!$('#editor').open) $('#editor').showModal();
  persistDraft();
}
function syncDraft() {if(draft) Object.assign(draft,{url:$('#post-url').value.trim(),author:$('#post-author').value.trim(),text:$('#post-text').value,excludedTags:[...excludedTags]});}
function applyHashtags() {
  if(!draft) return;
  draft.tags = normalizeTags([...extractHashtags(draft.text).filter(tag=>!excludedTags.has(tag)),...draft.tags]);
  renderDraftTags();
}
function persistDraft() {syncDraft(); try {if(draft) sessionStorage.setItem(DRAFT_KEY,JSON.stringify(draft));} catch {}}
function renderDraftTags() {$('#draft-tags').innerHTML = draft.tags.map(t=>tagChip(t,true)).join('') || '<span class="no-tag">AIの提案を使うか、好きなタグを追加してください。</span>';}
function renderPages() {$('#pages').innerHTML = draft.pages.map(p=>`<div class="page-result ${p.status === 'ok' ? '' : 'failed'}">${icon(p.status === 'ok' ? 'check' : 'link')}<div><a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.title || new URL(p.url).hostname)}</a><small>${p.status === 'ok' ? 'リンク先の内容を取得済み' : esc(p.error || '取得できませんでした。')}</small></div></div>`).join('');}
function addTag() {const value = $('#tag-input').value; if(!value.trim()) return; draft.tags = normalizeTags([...draft.tags,value]); excludedTags.delete(value.trim().replace(/^[#＃]+/,'')); $('#tag-input').value = ''; renderDraftTags(); persistDraft(); $('#tag-input').focus();}
function setAnalyzing(value) {analyzing = value; $('#analyze').disabled = value; $('#reanalyze').disabled = value; $('#analyze').textContent = value ? '解析中…' : '内容を解析する'; $('#save-post').disabled = value;}
async function analyzeDraft({force = false} = {}) {
  if (analyzing || !draft) return;
  syncDraft(); applyHashtags(); let post;
  try {post = normalizePost(draft);} catch (error) {$('#editor-error').textContent = error.message; return;}
  $('#editor-error').textContent = ''; $('#analysis-status').textContent = '本文とリンク先を確認して、AIがタグを考えています…';
  setAnalyzing(true); controller = new AbortController(); const active = draft;
  const signal = controller.signal;
  try {
    let key = null;
    try {key = await analysisCache.key(post, state.config?.model || DEFAULT_MODEL, state.config?.analysisVersion);} catch { /* 保存機能が使えなくても解析は続行する。 */ }
    const obtain = async () => {
      if(signal.aborted) throw new DOMException('解析を中止しました。','AbortError');
      const cached = !force && key && analysisCache.get(key, post);
      if(cached) return {result:cached, reused:true, ok:true};
      const response = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({...post,existingTags:allTags()})});
      const result = await response.json();
      if(response.ok && key) analysisCache.put(key, result, post);
      return {result, reused:false, ok:response.ok};
    };
    // 対応ブラウザーでは別タブの同時解析も待ち合わせ、保存済みの結果を使う。
    const {result, reused, ok} = key && navigator.locks ? await navigator.locks.request('postnote-analysis-'+key, {signal}, obtain) : await obtain();
    if(draft !== active) return;
    syncDraft();
    let current;
    try {current = normalizePost(draft);} catch {}
    if(!current || current.text !== post.text || current.url !== post.url) {$('#analysis-status').textContent = '解析中に本文またはURLが変更されました。変更後の内容で解析してください。'; return;}
    if (result.pages) {draft.pages = normalizePost({...post,pages:result.pages}).pages; renderPages();}
    if(!ok) throw new Error(result.error || 'AIタグ提案を実行できませんでした。');
    draft.tags = normalizeTags([...draft.tags,...result.tags.filter(t=>!excludedTags.has(t))]);
    $('#analysis-status').textContent = `${reused ? '保存済みの提案を再利用しました。API料金は発生しません。リンク先の更新を確認したい場合は再解析できます。' : 'タグを提案しました。同じ内容の結果は30日間再利用します。'}${result.skippedLinks ? ` 最初の5件のリンクを確認しました（残り${result.skippedLinks}件は未確認）。` : ''}`;
    $('#reanalyze').hidden = false;
    renderDraftTags(); persistDraft();
  } catch (error) {if(error.name !== 'AbortError' && draft === active) {$('#analysis-status').textContent = error.message || '通信に失敗しました。'; $('#analysis-status').append(Object.assign(document.createElement('button'),{textContent:'AI設定を開く',className:'text-button',onclick:openSettings}));}}
  finally {if(draft === active) setAnalyzing(false);}
}
function saveDraft(event) {
  event.preventDefault(); if(analyzing) return;
  syncDraft(); applyHashtags(); if($('#tag-input').value.trim()) addTag();
  try {
    const post = normalizePost({...draft,updatedAt:Date.now()});
    state.posts = upsertPosts([post]);
    try {sessionStorage.removeItem(DRAFT_KEY);} catch {}
    $('#editor').close(); state.filter = null; state.search = ''; $('#search').value = ''; state.error = ''; renderAll(); toast('ブックマークを保存しました。');
  } catch(error) {$('#editor-error').textContent = error.name === 'QuotaExceededError' ? '保存容量がいっぱいです。バックアップ後、不要なブックマークを削除してください。' : error.message || '保存できませんでした。';}
}

async function loadConfig() {
  try {const response = await fetch('/api/analyze'); if(!response.ok) throw new Error(); state.config = await response.json();} catch {state.config = null;}
  $('#ai-dot').classList.toggle('ready',Boolean(state.config?.configured));
}
function openSettings() {
  $('#config-status').textContent = state.config?.configured ? `OpenAI API 設定済み / ${state.config.model}。${hasSession() ? 'このブラウザーではAIタグ提案を利用できます。' : 'アクセスコードを入力するとタグ提案を利用できます。'}` : 'AIタグ提案はサーバーの設定待ちです。手動でタグを付けて保存できます。';
  $('#access-code').value = ''; $('#settings-error').textContent = ''; $('#settings').showModal();
}
async function saveSettings(event) {
  event.preventDefault(); const button=event.submitter;button.disabled=true;$('#settings-error').textContent='';
  try {const response=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'authenticate',accessCode:$('#access-code').value.trim()})});const data=await response.json();if(!response.ok)throw new Error(data.error);$('#access-code').value='';await loadConfig();$('#settings').close();toast('AIタグ提案を利用できます。');if($('#editor').open)analyzeDraft();}
  catch(error){$('#settings-error').textContent=error.message || '設定を保存できませんでした。';}finally{button.disabled=false;}
}
function downloadFile(data,filename) {const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a = document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importBackup(event) {
  const file = event.target.files[0]; if(!file) return;
  try {
    if(file.size > 10_000_000) throw new Error('10MB以下のバックアップを選択してください。');
    const data = JSON.parse(await file.text());
    const posts = Array.isArray(data) ? data : data.bookmarks;
    if(!Array.isArray(posts) || posts.length > 10000) throw new Error('バックアップの形式を確認してください。');
    const normalized = posts.map(normalizePost);
    if(!confirm(`${normalized.length}件を読み込みます。同じポストがある場合はバックアップの内容で更新します。よろしいですか？`)) return;
    state.posts = upsertPosts(normalized); state.error = '';renderAll();toast(`${normalized.length}件のブックマークを読み込みました。`);
  } catch(error) {toast(`読み込めませんでした。${error.message}`);} finally {event.target.value='';}
}
function onClick(event) {
  const el = event.target.closest('button, [data-action]'); if(!el) return;
  if(el.dataset.close) {$( '#'+el.dataset.close).close(); return;}
  if(el.hasAttribute('data-filter') || el.hasAttribute('data-nav')) {const value=el.dataset.filter ?? el.dataset.nav;state.filter=value === '__all' ? null : value;renderAll();return;}
  if(el.hasAttribute('data-remove-tag') && draft) {excludedTags.add(el.dataset.removeTag);draft.tags=draft.tags.filter(t=>t!==el.dataset.removeTag);renderDraftTags();persistDraft();return;}
  if(el.dataset.edit) {const post=state.posts.find(p=>p.id===el.dataset.edit);if(post) openEditor(post,true);return;}
  if(el.dataset.delete) {
    if(!confirm('このブックマークを削除しますか？ Xの元ポストは削除されません。')) return;
    try {const posts=readPosts().filter(p=>p.id!==el.dataset.delete);localStorage.setItem(STORAGE_KEY,JSON.stringify(posts));state.posts=posts;renderAll();toast('ブックマークを削除しました。');} catch {toast('削除できませんでした。');} return;
  }
  switch(el.dataset.action) {
    case 'add': {let saved=null;try {saved=JSON.parse(sessionStorage.getItem(DRAFT_KEY));} catch {} openEditor(saved || {});break;}
    case 'setup': $('#setup').showModal();break;
    case 'settings': openSettings();break;
    case 'reset': state.filter=null;state.search='';$('#search').value='';renderAll();break;
    case 'export': try {downloadFile({version:1,exportedAt:new Date().toISOString(),bookmarks:readPosts()},`postnote-${new Date().toISOString().slice(0,10)}.json`);toast('バックアップを書き出しました。');} catch {toast('保存データを読み取れないため書き出せませんでした。');}break;
    case 'import': $('#import-file').click();break;
    case 'copy-bookmarklet': navigator.clipboard.writeText(buildBookmarklet(location.origin)).then(()=>toast('ブックマークレットをコピーしました。')).catch(()=>{$('#bookmarklet-code').focus();$('#bookmarklet-code').select();toast('コードを選択しました。手動でコピーしてください。');});break;
  }
}

loadPosts(); renderShell(); renderAll();
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY || event.key===null){loadPosts();renderAll();}});
const configPromise = loadConfig();
async function receiveCapture() {
  if(!location.hash.startsWith('#capture=')) return;
  const raw = location.hash.slice(9); history.replaceState(null,'',location.pathname+location.search);
  try {
    if(raw.length > 400000) throw new Error('ポストが大きすぎます。');
    const incoming = normalizePost(JSON.parse(decodeURIComponent(raw)));
    const old = state.posts.find(p=>p.id===incoming.id);
    openEditor({...incoming,tags:old?.tags || [],excludedTags:old?.excludedTags || [],createdAt:old?.createdAt || incoming.createdAt},Boolean(old));
    await configPromise;
    if(draft && state.config?.configured && hasSession()) analyzeDraft();
    else if(draft) {$('#analysis-status').textContent = 'AIタグ提案を使うには「AI設定」でアクセスコードを入力してください。';$('#analysis-status').append(Object.assign(document.createElement('button'),{textContent:'AI設定を開く',className:'text-button',onclick:openSettings}));}
  } catch(error) {toast(`ポストを取り込めませんでした。${error.message}`);}
}
receiveCapture(); window.addEventListener('hashchange',receiveCapture);
