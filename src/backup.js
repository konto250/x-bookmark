import { normalizePost, upsertPosts, STORAGE_KEY } from './model.js';

export const MAX_BACKUP_BYTES = 50_000_000;

export function createBackup(posts, now = new Date()) {
  return {app:'postnote', version:1, exportedAt:now.toISOString(), bookmarks:posts.map(normalizePost)};
}

export function parseBackup(source) {
  let data;
  try {data = JSON.parse(source.replace(/^\uFEFF/,''));} catch {throw new Error('JSONファイルを読み取れませんでした。ポストノートのバックアップを選んでください。');}
  if(!Array.isArray(data) && (!data || data.version !== 1 || (data.app && data.app !== 'postnote'))) throw new Error('対応していないバックアップ形式です。');
  const rows = Array.isArray(data) ? data : data.bookmarks;
  if(!Array.isArray(rows)) throw new Error('ブックマークの一覧が含まれていません。');
  const posts = rows.map((row,index) => {
    try {
      if(!row || typeof row !== 'object') throw new Error();
      for(const key of ['text','author']) if(row[key] !== undefined && typeof row[key] !== 'string') throw new Error();
      for(const key of ['tags','excludedTags','links']) if(row[key] !== undefined && (!Array.isArray(row[key]) || !row[key].every(v=>typeof v === 'string'))) throw new Error();
      if(row.pages !== undefined && (!Array.isArray(row.pages) || !row.pages.every(p=>p && typeof p === 'object' && typeof p.url === 'string'))) throw new Error();
      for(const key of ['createdAt','updatedAt']) if(row[key] !== undefined && (!Number.isFinite(row[key]) || row[key] <= 0 || row[key] >= 8640000000000000)) throw new Error();
      return normalizePost(row);
    } catch {throw new Error(`${index+1}件目のブックマークが不正です。保存データは変更していません。`);}
  });
  return [...new Map(posts.map(post=>[post.id,post])).values()];
}

export function restoreBackup(posts, mode = 'merge', storage = localStorage) {
  // 全件の検証が済むまで保存せず、容量エラー時も既存データを残す。
  const normalized = posts.map(normalizePost);
  if(mode === 'merge') return upsertPosts(normalized,storage);
  if(mode !== 'replace') throw new Error('復元方法を選んでください。');
  storage.setItem(STORAGE_KEY,JSON.stringify(normalized));
  return normalized;
}
