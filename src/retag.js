import { STORAGE_KEY, readPosts, normalizePost, normalizeTags, extractHashtags } from './model.js';
import { preferExistingTags, tagKey } from './tag-policy.js';

export const RETAG_UNDO_KEY = 'postnote.retag.undo.v1';
const fingerprint = post => JSON.stringify(normalizePost(post));

export function proposedRetag(post, tags, catalog, keepOriginal = false) {
  const excluded=new Set(post.excludedTags.map(tagKey));
  const hashtags=extractHashtags(post.text).filter(tag=>!excluded.has(tagKey(tag)));
  const hashtagKeys=new Set(hashtags.map(tagKey));
  const ai=preferExistingTags(tags,catalog).filter(tag=>!excluded.has(tagKey(tag)) && !hashtagKeys.has(tagKey(tag)));
  return normalizeTags([...(keepOriginal ? post.tags : []),...hashtags,...ai]);
}

export function applyRetags(changes, storage = localStorage, now = Date.now()) {
  const current=readPosts(storage),byId=new Map(current.map(post=>[post.id,post]));
  const updates=new Map();
  for(const {before,tags} of changes) {
    const latest=byId.get(before.id);
    if(!latest || fingerprint(latest)!==fingerprint(before)) throw new Error('解析後に変更・削除されたポストがあります。一覧を開き直して確認してください。まだ適用していません。');
    const normalized=normalizeTags(tags);
    if(JSON.stringify([...latest.tags].sort())===JSON.stringify([...normalized].sort())) continue;
    updates.set(latest.id,{before:latest,after:{...latest,tags:normalized,updatedAt:now}});
  }
  if(!updates.size) return {posts:current,count:0};
  const previousUndo=storage.getItem(RETAG_UNDO_KEY);
  // 元に戻す情報を確保できなければ、ブックマークは変更しない。
  storage.setItem(RETAG_UNDO_KEY,JSON.stringify({version:1,appliedAt:now,changes:[...updates.values()]}));
  const posts=current.map(post=>updates.get(post.id)?.after || post);
  try {storage.setItem(STORAGE_KEY,JSON.stringify(posts));}
  catch(error) {
    try {if(previousUndo===null) storage.removeItem(RETAG_UNDO_KEY);else storage.setItem(RETAG_UNDO_KEY,previousUndo);} catch {}
    throw error;
  }
  return {posts,count:updates.size};
}

export function undoRetags(storage = localStorage) {
  const raw=storage.getItem(RETAG_UNDO_KEY);
  if(!raw) throw new Error('元に戻せる付け直し履歴がありません。');
  const undo=JSON.parse(raw);
  if(undo?.version!==1 || !Array.isArray(undo.changes)) throw new Error('付け直し履歴を読み取れません。');
  const current=readPosts(storage),byId=new Map(current.map(post=>[post.id,post]));
  const originals=new Map();
  for(const change of undo.changes) {
    const before=normalizePost(change.before),after=normalizePost(change.after),latest=byId.get(after.id);
    if(before.id!==after.id || !latest || fingerprint(latest)!==fingerprint(after)) throw new Error('付け直し後に変更・削除されたポストがあるため、一括では元に戻せません。現在のデータは変更していません。');
    originals.set(before.id,before);
  }
  const posts=current.map(post=>originals.get(post.id) || post);
  storage.setItem(STORAGE_KEY,JSON.stringify(posts));
  storage.removeItem(RETAG_UNDO_KEY);
  return {posts,count:originals.size};
}
