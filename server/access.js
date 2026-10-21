import { authenticated } from './auth.js';

export const LOGIN_HTML = `<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>ログイン — ポストノート</title><link rel="stylesheet" href="/login.css"><link rel="icon" href="/favicon.svg"></head><body><main class="login-card"><div class="mark" aria-hidden="true">P</div><p class="eyebrow">自分だけのブックマーク</p><h1>ポストノート</h1><p>パスワードを入力してログインしてください。</p><form id="login-form"><label for="password">パスワード</label><input id="password" name="password" type="password" required maxlength="1024" autocomplete="current-password" autofocus><button id="login-button" type="submit">ログイン</button><p id="login-error" role="alert"></p></form><p class="hint">このブラウザーでログイン状態を30日間保持します。</p><noscript>ログインするにはJavaScriptを有効にしてください。</noscript></main><script src="/login.js" defer></script></body></html>`;

export function accessResponse(request, secret = process.env.APP_ACCESS_TOKEN) {
  const path=new URL(request.url).pathname;
  if(['/login.js','/login.css','/favicon.svg','/api/session'].includes(path)) return null;
  if(authenticated({headers:{cookie:request.headers.get('cookie')}},secret)) return null;
  const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
  if((path === '/' || path === '/index.html') && ['GET','HEAD'].includes(request.method)) return new Response(request.method === 'HEAD' ? null : LOGIN_HTML,{status:200,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
  return Response.json({error:'ログインが必要です。'},{status:401,headers});
}
