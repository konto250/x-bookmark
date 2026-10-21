import { normalizePost, normalizeTags } from './model.js';
import { ANALYSIS_VERSION } from './analysis-config.js';

export const ANALYSIS_CACHE_KEY = 'postnote.analysis.v1';
export const CACHE_TTL = 30 * 86400000;
const MAX_ENTRIES = 100;
const MAX_CHARS = 500000;

// 保存済みタグの増減は分類のヒントなので、再課金の理由にしない。
export function createAnalysisCache({storage, crypto, now = Date.now}) {
  function read() {
    try {
      const entries = JSON.parse(storage().getItem(ANALYSIS_CACHE_KEY) || '[]');
      return Array.isArray(entries) ? entries.filter(e => e && typeof e.key === 'string' && e.time <= now() && now() - e.time < CACHE_TTL).slice(-MAX_ENTRIES) : [];
    } catch {return [];}
  }
  return {
    async key(post, model, version = ANALYSIS_VERSION) {
      const input = JSON.stringify([version, model, post.url, post.text, [...new Set(post.links)]]);
      const bytes = new TextEncoder().encode(input);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
    },
    get(key, post) {
      const entry = read().find(e => e.key === key);
      if (!entry || !Array.isArray(entry.result?.tags) || !Array.isArray(entry.result?.pages)) return null;
      try {
        return {...entry.result, tags: normalizeTags(entry.result.tags), pages: normalizePost({...post, pages: entry.result.pages}).pages};
      } catch {return null;}
    },
    put(key, result, post) {
      const clean = {tags: normalizeTags(result.tags), pages: normalizePost({...post, pages: result.pages}).pages, skippedLinks: Number(result.skippedLinks) || 0};
      const entries = [...read().filter(e => e.key !== key), {key, time: now(), result: clean}].slice(-MAX_ENTRIES);
      while (JSON.stringify(entries).length > MAX_CHARS && entries.length) entries.shift();
      try {storage().setItem(ANALYSIS_CACHE_KEY, JSON.stringify(entries));} catch { /* 容量不足でも提案とブックマーク保存を続行する。 */ }
    }
  };
}
