const form=document.querySelector('#login-form');
const password=document.querySelector('#password');
const button=document.querySelector('#login-button');
const error=document.querySelector('#login-error');
// Xからの別サイト遷移ではStrict Cookieが初回リクエストに付かないため、同一サイト内で確認する。
fetch('/api/session',{cache:'no-store'}).then(response=>response.ok ? response.json() : null).then(result=>{if(result?.authenticated) location.reload();}).catch(()=>{});
form.addEventListener('submit',async event=>{
  event.preventDefault();button.disabled=true;error.textContent='';
  try {
    const value=password.value;password.value='';
    const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',password:value})});
    const result=await response.json();
    if(!response.ok || !result.authenticated) throw new Error(result.error || 'ログインできませんでした。');
    // URLフラグメントの取り込みデータを保ったまま、認証済みの画面を取得する。
    location.reload();
  } catch(cause) {error.textContent=cause.message || '通信できませんでした。再試行してください。';password.focus();}
  finally {button.disabled=false;}
});
