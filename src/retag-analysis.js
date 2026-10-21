import { DEFAULT_MODEL } from './analysis-config.js';

function pause(ms, signal) {
  signal.throwIfAborted();
  if(ms<=0) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}

export function createSavedPostAnalyzer({getConfig,cache,fetcher,locks,onUnauthorized,interval=6000,now=Date.now}) {
  let nextRequestAt=0;
  return async (post,{signal,catalog})=>{
    const config=await getConfig();
    signal.throwIfAborted();
    if(!config?.configured || !config.authenticated) throw new Error('AI設定とログイン状態を確認してください。');
    const key=await cache.key(post,config.model || DEFAULT_MODEL,config.analysisVersion);
    const obtain=async()=>{
      signal.throwIfAborted();
      const cached=key && cache.get(key,post);
      if(cached) return {...cached,reused:true};
      // キャッシュ利用時は待たず、実際のAPI呼び出しだけ間隔を空ける。
      await pause(nextRequestAt-now(),signal);
      signal.throwIfAborted();
      nextRequestAt=now()+interval;
      const response=await fetcher('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...post,existingTags:catalog}),signal});
      if(response.status===401) {onUnauthorized();throw new DOMException('ログインが必要です。','AbortError');}
      const result=await response.json();
      signal.throwIfAborted();
      if(!response.ok) throw new Error(result.error || 'AIタグ提案を実行できませんでした。');
      if(key) cache.put(key,result,post);
      return {...result,reused:false};
    };
    return key && locks ? locks.request('postnote-analysis-'+key,{signal},obtain) : obtain();
  };
}
