import { authenticated, sessionCookie, validAccessCode } from '../server/auth.js';
import { inspectPage } from '../server/pages.js';
import { proposeTags } from '../server/llm.js';
import { extractUrls, normalizePost, normalizeTags } from '../src/model.js';

const buckets = new Map();
function allowRequest(ip) {
  const now = Date.now();
  for (const [key, val] of buckets) if (val.until < now) buckets.delete(key);
  const entry = buckets.get(ip) || {count: 0, until: now + 60000};
  entry.count++; buckets.set(ip, entry);
  return entry.count <= 12;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const send = (code, body) => {res.statusCode = code; res.end(JSON.stringify(body));};
  if (req.method === 'GET') return send(200, {configured: Boolean(process.env.OPENAI_API_KEY && process.env.APP_ACCESS_TOKEN), authenticated: authenticated(req), provider: 'OpenAI', model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', accessTokenRequired: true});
  if (req.method !== 'POST') {res.setHeader('Allow','GET, POST'); return send(405,{error:'この操作は対応していません。'});}
  if (!process.env.OPENAI_API_KEY || !process.env.APP_ACCESS_TOKEN) return send(503,{error:'AIタグ提案は設定待ちです。Vercelの環境変数にOPENAI_API_KEYとAPP_ACCESS_TOKENを設定してください。手動タグでの保存は利用できます。'});
  const origin = req.headers.origin;
  if(origin) {
    try {if(new URL(origin).host !== req.headers.host) return send(403,{error:'このアプリから操作してください。'});} catch {return send(403,{error:'送信元が不正です。'});}
  }
  if (!allowRequest(req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown')) {res.setHeader('Retry-After','60'); return send(429,{error:'リクエストが続いています。1分後に再試行してください。'});}
  try {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(415,{error:'JSON形式で送信してください。'});
    let body = req.body;
    if (body === undefined) {
      let size = 0; const chunks = [];
      for await (const chunk of req) {size += chunk.length; if (size > 150000) return send(413,{error:'データが大きすぎます。'}); chunks.push(chunk);}
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (typeof body === 'string') {if (Buffer.byteLength(body) > 150000) return send(413,{error:'データが大きすぎます。'}); body = JSON.parse(body);}
    if (Buffer.byteLength(JSON.stringify(body)) > 150000) return send(413,{error:'データが大きすぎます。'});
    if(body?.action === 'authenticate') {
      if(!validAccessCode(body.accessCode,process.env.APP_ACCESS_TOKEN)) return send(401,{error:'アクセスコードが正しくありません。'});
      res.setHeader('Set-Cookie',sessionCookie(process.env.APP_ACCESS_TOKEN,process.env.VERCEL === '1' || req.headers['x-forwarded-proto'] === 'https'));
      return send(200,{authenticated:true});
    }
    if(!authenticated(req)) return send(401,{error:'「AI設定」でこのアプリのアクセスコードを入力してください。'});
    let post;
    try {post = normalizePost(body);} catch (error) {return send(400,{error: error.message});}
    const urls = [...new Set([...post.links, ...extractUrls(post.text)])].filter(u => !/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//.test(u));
    const pages = await Promise.all(urls.slice(0,5).map(inspectPage));
    try {
      const result = await proposeTags({text: post.text, pages, existingTags: normalizeTags(body.existingTags)});
      return send(200,{...result, pages: pages.map(({text, ...p}) => p), skippedLinks: Math.max(0,urls.length-5)});
    } catch (error) {
      return send(502,{error: error.name === 'TimeoutError' ? 'AIの応答が時間内に返りませんでした。再試行してください。' : error.message, pages: pages.map(({text,...p})=>p)});
    }
  } catch (error) {
    return send(error instanceof SyntaxError ? 400 : 500,{error: error instanceof SyntaxError ? '送信データを読み取れませんでした。' : 'タグ提案を実行できませんでした。手動でタグを追加して保存できます。'});
  }
}
