import { normalizeTags } from './model.js';

export const tagKey = tag => tag.normalize('NFKC').toLowerCase();

export function normalizeTagCatalog(tags) {
  const seen=new Set(),result=[];
  for(const value of Array.isArray(tags) ? tags : []) {
    const tag=normalizeTags([value])[0];
    if(!tag || seen.has(tagKey(tag))) continue;
    seen.add(tagKey(tag));result.push(tag);
    if(result.length >= 500) break;
  }
  return result;
}

export function existingTagsByUsage(posts) {
  const counts=new Map();
  for(const post of posts) for(const tag of normalizeTags(post.tags)) counts.set(tag,(counts.get(tag)||0)+1);
  return normalizeTagCatalog([...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a)||a.localeCompare(b,'ja')));
}

// 大文字・小文字や全角・半角だけの差は、保存済みの表記に揃える。
export function preferExistingTags(tags, existingTags) {
  const catalog=new Map(normalizeTagCatalog(existingTags).map(tag=>[tagKey(tag),tag]));
  return normalizeTagCatalog(normalizeTags(tags).map(tag=>catalog.get(tagKey(tag)) || tag));
}
