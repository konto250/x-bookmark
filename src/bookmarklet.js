// 外部スクリプトを読み込まず、表示中のポストだけを取得する。
function capturePost(destination) {
  if (!/^(www\.)?(x\.com|twitter\.com)$/.test(location.hostname)) {
    alert('Xで保存したいポストの詳細ページを開いてから実行してください。'); return;
  }
  const match = location.pathname.match(/\/status\/(\d+)/);
  if (!match) { alert('保存したいポストの日時をクリックし、詳細ページを開いてください。'); return; }
  const textOf = element => (element?.innerText || element?.textContent || '').trim();
  const permalink = href => {
    try {
      const url = new URL(href, location.href);
      const path = url.pathname.match(/^\/(?:[\w]+|i\/web)\/status\/(\d+)(?:\/|$)/);
      return /^(www\.)?(x\.com|twitter\.com)$/.test(url.hostname) && path ? {id: path[1], url: 'https://x.com' + path[0].replace(/\/$/, '')} : null;
    } catch { return null; }
  };
  const ownContent = (element, article) => {
    for (let parent = element; parent && parent !== article; parent = parent.parentElement) {
      if (parent.matches('[data-testid="quoteTweet"], div[role="link"]')) return false;
      if (parent !== element && parent.matches('[data-testid="tweet"], article')) return false;
    }
    return true;
  };
  let articles = [...document.querySelectorAll('[data-testid="tweet"]')];
  if (!articles.length) articles = [...document.querySelectorAll('article')].filter(el => el.querySelector('[data-testid="tweetText"]'));
  articles = articles.filter(el => !el.closest('[aria-hidden="true"], [hidden]'));
  const candidates = articles.map(article => {
    // 詳細ページの日時はtime要素とは限らない。引用や本文内の別ポストURLは識別に使わない。
    const identities = [...article.querySelectorAll('a[href]')].filter(a => ownContent(a, article) && !a.closest('[data-testid="tweetText"], [data-testid="card.wrapper"]')).map(a => permalink(a.getAttribute('href'))).filter(Boolean);
    const body = [...article.querySelectorAll('[data-testid="tweetText"]')].find(el => ownContent(el, article));
    const author = [...article.querySelectorAll('[data-testid="User-Name"]')].find(el => ownContent(el, article));
    const links = [...(body?.querySelectorAll('a[href]') || [])].map(a => {
      const title = a.getAttribute('title');
      return title && /^https?:\/\//.test(title) && !/[…\u2026]/.test(title) ? title : a.href;
    }).filter(href => /^https?:\/\//.test(href) && !/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:hashtag|search)\b/.test(href));
    return {article, identities, payload: {url: identities[0]?.url || permalink(location.href).url, text: textOf(body).slice(0, 30000), author: textOf(author), links: [...new Set(links)].slice(0, 10)}};
  });
  const save = candidate => {
    if (candidate.article.querySelector('[data-testid="tweet-text-show-more-link"]')) {
      alert('長いポストは表示中の本文だけを取得します。全文を保存する場合は「さらに表示」で展開してから再実行してください。');
    }
    const target = destination + '/#capture=' + encodeURIComponent(JSON.stringify(candidate.payload));
    window.open(target, '_blank', 'noopener,noreferrer');
  };
  const selected = candidates.find(candidate => candidate.identities.some(identity => identity.id === match[1]));
  if (selected) {
    selected.payload.url = permalink(location.href).url;
    save(selected);
    return;
  }
  if (!candidates.length) {
    alert('画面内にポストが見つかりませんでした。Xのポスト詳細を再読み込みし、本文が表示されてから再実行してください。');
    return;
  }
  // 固定リンクが省略された画面では、返信を推測で保存せず本人に本文を選んでもらう。
  document.querySelector('[data-postnote-picker]')?.remove();
  const picker = document.createElement('dialog');
  picker.setAttribute('data-postnote-picker', '');
  picker.setAttribute('aria-label', '保存するポストを選択');
  Object.assign(picker.style, {background:'#fff',color:'#302c40',border:'1px solid #d9cbed',borderRadius:'12px',padding:'22px',width:'520px',maxWidth:'90vw',maxHeight:'80vh',overflow:'auto',font:'14px sans-serif',boxShadow:'0 12px 70px #0005'});
  const heading = document.createElement('h2');
  heading.textContent = '保存するポストを選んでください';
  heading.style.fontSize = '18px';
  picker.append(heading);
  const note = document.createElement('p');
  note.textContent = 'この画面では対象を自動判定できませんでした。保存したい本文を選ぶと続行します。';
  Object.assign(note.style, {fontSize:'12px',lineHeight:'1.8'});
  picker.append(note);
  candidates.forEach(candidate => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = [candidate.payload.author, candidate.payload.text.slice(0, 240) || '（本文なし・画像や引用のみ）', candidate.identities.length ? candidate.payload.url : 'URL：現在開いているポスト詳細'].filter(Boolean).join('\n');
    Object.assign(button.style, {display:'block',width:'100%',whiteSpace:'pre-wrap',textAlign:'left',padding:'14px',margin:'10px 0',background:'#f6f1fb',color:'#302c40',border:'1px solid #e4d9ef',borderRadius:'8px',cursor:'pointer',font:'13px/1.7 sans-serif'});
    button.addEventListener('click', () => {picker.remove(); save(candidate);});
    picker.append(button);
  });
  const cancel = document.createElement('button');
  cancel.type = 'button'; cancel.textContent = 'キャンセル';
  Object.assign(cancel.style, {padding:'10px 16px',background:'#eee',color:'#333',border:'0',borderRadius:'6px',cursor:'pointer'});
  cancel.addEventListener('click', () => picker.remove());
  picker.append(cancel);
  picker.addEventListener('cancel', () => picker.remove());
  document.body.append(picker);
  if (typeof picker.showModal === 'function') picker.showModal();
  else {picker.setAttribute('open', ''); Object.assign(picker.style, {position:'fixed',top:'10vh',left:'5vw',zIndex:'2147483647'});}
}

export function buildBookmarklet(origin) {
  return `javascript:(${capturePost.toString()})(${JSON.stringify(new URL(origin).origin)});void(0);`;
}
