// 外部スクリプトを読み込まず、表示中のポストだけを取得する。
function capturePost(destination) {
  if (!/^(www\.)?(x\.com|twitter\.com)$/.test(location.hostname)) {
    alert('Xで保存したいポストの詳細ページを開いてから実行してください。'); return;
  }
  const match = location.pathname.match(/\/status\/(\d+)/);
  if (!match) { alert('保存したいポストの日時をクリックし、詳細ページを開いてください。'); return; }
  const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
  const article = articles.find(el => {
    const time = el.querySelector('time');
    return time?.closest('a')?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1] === match[1];
  });
  if (!article) { alert('ポストを読み取れませんでした。本文が表示されるまで待ってから再実行してください。'); return; }
  const body = article.querySelector('[data-testid="tweetText"]');
  const text = body?.innerText || '';
  const links = [...(body?.querySelectorAll('a[href]') || [])].map(a => {
    const title = a.getAttribute('title');
    return title && /^https?:\/\//.test(title) && !/[…\u2026]/.test(title) ? title : a.href;
  }).filter(href => /^https?:\/\//.test(href) && !/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:hashtag|search)\b/.test(href));
  const payload = {url: location.origin + location.pathname.split('/').slice(0, location.pathname.startsWith('/i/web/') ? 5 : 4).join('/'), text: text.slice(0, 30000), author: article.querySelector('[data-testid="User-Name"]')?.innerText || '', links: [...new Set(links)].slice(0, 10)};
  if (article.querySelector('[data-testid="tweet-text-show-more-link"]')) {
    alert('長いポストは表示中の本文だけを取得します。全文を保存する場合は「さらに表示」で展開してから再実行してください。');
  }
  const target = destination + '/#capture=' + encodeURIComponent(JSON.stringify(payload));
  window.open(target, '_blank', 'noopener,noreferrer');
}

export function buildBookmarklet(origin) {
  return `javascript:(${capturePost.toString()})(${JSON.stringify(new URL(origin).origin)});void(0);`;
}
