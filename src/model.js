export const STORAGE_KEY = 'postnote.bookmarks.v1';
export const DRAFT_KEY = 'postnote.draft.v1';

export function postUrl(value) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || !/^(www\.)?(x\.com|twitter\.com)$/.test(u.hostname)) return null;
    const match = u.pathname.match(/^\/(?:[a-zA-Z0-9_]+|i\/web)\/status\/(\d+)(?:\/|$)/);
    return match ? `https://x.com/${u.pathname.split('/')[1] === 'i' ? 'i/web' : u.pathname.split('/')[1]}/status/${match[1]}` : null;
  } catch { return null; }
}

export function webUrl(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

export function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).filter(t => typeof t === 'string').map(t => t.trim().replace(/^[#＃]+/, '').slice(0, 40)).filter(Boolean))].slice(0, 30);
}

export function extractHashtags(text) {
  // URLのフラグメントはハッシュタグとして扱わない。
  const body = String(text || '').replace(/https?:\/\/[^\s<>"\u3000、。「」『』【】（）]+/gi, ' ');
  return normalizeTags([...body.matchAll(/[#＃]([\p{L}\p{M}\p{N}_]+)/gu)].map(match => match[1]));
}

export function normalizePost(input) {
  if (!input || typeof input !== 'object') throw new Error('ポストのデータが不正です。');
  const url = postUrl(input.url);
  if (!url) throw new Error('XのポストURL（https://x.com/ユーザー名/status/数字）を入力してください。');
  const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
  return {
    id: url.match(/status\/(\d+)/)[1], url,
    text: str(input.text, 30000), author: str(input.author, 160),
    links: [...new Set((Array.isArray(input.links) ? input.links : []).filter(v => typeof v === 'string').map(webUrl).filter(Boolean))].slice(0, 10),
    tags: normalizeTags(input.tags),
    excludedTags: normalizeTags(input.excludedTags),
    pages: (Array.isArray(input.pages) ? input.pages : []).slice(0, 5).filter(p => p && webUrl(p.url)).map(p => ({url: webUrl(p.url), title: str(p.title, 300), description: str(p.description, 500), status: p.status === 'ok' ? 'ok' : 'error', error: str(p.error, 300)})),
    createdAt: Number.isFinite(input.createdAt) && input.createdAt > 0 && input.createdAt < 8640000000000000 ? input.createdAt : Date.now(),
    updatedAt: Number.isFinite(input.updatedAt) && input.updatedAt > 0 && input.updatedAt < 8640000000000000 ? input.updatedAt : Date.now()
  };
}

export function readPosts(storage = localStorage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('保存データの形式が不正です。');
  return data.map(normalizePost);
}

export function upsertPosts(incoming, storage = localStorage) {
  const existing = readPosts(storage);
  const merged = new Map(existing.map(p => [p.id, p]));
  for (const raw of incoming) {
    const post = normalizePost(raw);
    const old = merged.get(post.id);
    merged.set(post.id, {...post, createdAt: old?.createdAt || post.createdAt});
  }
  const result = [...merged.values()];
  storage.setItem(STORAGE_KEY, JSON.stringify(result));
  return result;
}

export function extractUrls(text) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"\u3000、。「」『』【】（）]+/g) || []).map(s => s.replace(/[,.)]+$/, '')).map(webUrl).filter(Boolean))];
}
