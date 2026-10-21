import { normalizeTagCatalog, tagKey } from '../src/tag-policy.js';
import { INPUT_LIMITS as limits } from '../src/analysis-config.js';

export function selectExistingTags(existingTags, text, pages) {
  const context=tagKey([text,...pages.flatMap(p=>[p.title,p.description,p.text])].join('\n'));
  // 入力順は使用頻度順。同順位ではその順序を保ち、本文に出るタグを先にする。
  const ranked=normalizeTagCatalog(existingTags).map((tag,index)=>({tag,index,match:context.includes(tagKey(tag))})).sort((a,b)=>Number(b.match)-Number(a.match)||a.index-b.index);
  const result=[];let chars=0;
  for(const {tag} of ranked) {
    if(chars+tag.length>limits.existingTagChars) continue;
    result.push(tag);chars+=tag.length;
    if(result.length>=limits.existingTags) break;
  }
  return result;
}
