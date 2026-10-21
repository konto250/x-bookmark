const form=document.querySelector('#login-form');
const password=document.querySelector('#password');
const button=document.querySelector('#login-button');
const error=document.querySelector('#login-error');
let navigating=false;
function enterApp(automatic=false) {
  if(navigating) return;
  const target=new URL(location.href);
  // 復帰先でもログイン画面になった場合は、自動遷移を繰り返さない。
  if(automatic && target.searchParams.has('_postnote_auth')) {
    error.textContent='ログイン状態を画面に引き継げませんでした。この画面でログインし直してください。';
    return;
  }
  // reloadでは元の外部サイトからの遷移扱いが残る環境があるため、別URLへ同一サイト内で遷移する。
  target.searchParams.set('_postnote_auth',target.searchParams.get('_postnote_auth')==='1'?'2':'1');
  navigating=true;
  location.replace(target.href);
}
// Xからの別サイト遷移ではStrict Cookieが初回リクエストに付かないため、同一サイト内で確認する。
fetch('/api/session',{cache:'no-store',credentials:'same-origin'}).then(response=>response.ok ? response.json() : null).then(result=>{if(result?.authenticated) enterApp(true);}).catch(()=>{});
form.addEventListener('submit',async event=>{
  event.preventDefault();button.disabled=true;error.textContent='';
  try {
    const value=password.value;password.value='';
    const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',password:value})});
    const result=await response.json();
    if(!response.ok || !result.authenticated) throw new Error(result.error || 'ログインできませんでした。');
    // URLフラグメントの取り込みデータを保ったまま、認証済みの画面を取得する。
    enterApp();
  } catch(cause) {error.textContent=cause.message || '通信できませんでした。再試行してください。';password.focus();}
  finally {button.disabled=false;}
});
