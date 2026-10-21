import { authenticated, sessionCookie, clearSessionCookie, validAccessCode } from '../server/auth.js';

// 分散環境全体の制限ではない。長いランダムなパスワードと併用する。
const attempts = new Map();
function allowAttempt(ip) {
  const now = Date.now();
  for(const [key,value] of attempts) if(value.until <= now) attempts.delete(key);
  if(!attempts.has(ip) && attempts.size >= 1000) attempts.delete(attempts.keys().next().value);
  const entry=attempts.get(ip) || {count:0,until:now+60000};
  entry.count++;attempts.set(ip,entry);return entry.count <= 5;
}

export default async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  const send=(code,body)=>{res.statusCode=code;res.end(JSON.stringify(body));};
  if(req.method === 'GET') return send(200,{authenticated:authenticated(req),configured:Boolean(process.env.APP_ACCESS_TOKEN)});
  if(req.method !== 'POST') {res.setHeader('Allow','GET, POST');return send(405,{error:'この操作は対応していません。'});}
  const secure=process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https';
  if(req.headers.origin !== `${secure?'https':'http'}://${req.headers.host}`) return send(403,{error:'このアプリの画面から操作してください。'});
  if(!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(415,{error:'JSON形式で送信してください。'});
  try {
    let body=req.body;
    if(body === undefined) {
      let size=0;const chunks=[];
      for await(const chunk of req) {size+=chunk.length;if(size>4096)return send(413,{error:'入力が長すぎます。'});chunks.push(chunk);}
      body=Buffer.concat(chunks).toString('utf8');
    }
    if(Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body))>4096) return send(413,{error:'入力が長すぎます。'});
    if(typeof body === 'string') body=JSON.parse(body);
    if(body?.action === 'logout') {res.setHeader('Set-Cookie',clearSessionCookie(secure));return send(200,{authenticated:false});}
    if(body?.action !== 'login') return send(400,{error:'操作を確認してください。'});
    if(!process.env.APP_ACCESS_TOKEN) return send(503,{error:'ログイン設定が未完了です。管理者がAPP_ACCESS_TOKENを設定してください。'});
    const ip=req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if(!allowAttempt(ip)) {res.setHeader('Retry-After','60');return send(429,{error:'ログインの試行が続いています。1分後に再試行してください。'});}
    if(typeof body.password !== 'string' || !validAccessCode(body.password,process.env.APP_ACCESS_TOKEN)) return send(401,{error:'パスワードが正しくありません。'});
    res.setHeader('Set-Cookie',sessionCookie(process.env.APP_ACCESS_TOKEN,secure));return send(200,{authenticated:true});
  } catch {return send(400,{error:'ログイン要求を読み取れませんでした。'});}
}
