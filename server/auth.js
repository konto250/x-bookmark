import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
const COOKIE = 'postnote_session';
const hash = value => createHash('sha256').update(value).digest();
const sign = (expiry, secret) => createHmac('sha256',secret).update(`postnote:${expiry}`).digest('hex');
export function validAccessCode(value, secret) {return Boolean(secret) && timingSafeEqual(hash(String(value || '')),hash(secret));}
export function sessionCookie(secret, secure = true, now = Date.now()) {
  const expiry = String(now + 30*86400000);
  return `${COOKIE}=${expiry}.${sign(expiry,secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure ? '; Secure' : ''}`;
}
export function authenticated(req, secret = process.env.APP_ACCESS_TOKEN, now = Date.now()) {
  if(!secret) return false;
  const value = String(req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!value) return false;
  const [expiry, signature] = value.split('.');
  if(!/^\d+$/.test(expiry) || Number(expiry) < now || Number(expiry) > now + 31*86400000 || !/^[0-9a-f]{64}$/.test(signature || '')) return false;
  return timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(expiry,secret),'hex'));
}
