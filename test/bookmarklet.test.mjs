import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildBookmarklet } from '../src/bookmarklet.js';

function capture(html, execute) {
  const dom=new JSDOM(html,{url:'https://x.com/owner/status/123/photo/1',runScripts:'outside-only'});
  const opened=[];const warnings=[];
  dom.window.open=url=>opened.push(JSON.parse(decodeURIComponent(new URL(url).hash.slice(9))));
  dom.window.alert=message=>warnings.push(message);
  try {dom.window.eval(buildBookmarklet('https://app.example').slice(11));execute({window:dom.window,opened,warnings});}finally{dom.window.close();}
}

test('引用の日時が先にあっても元ポストの本文とリンクを取り込む',()=>{
  capture('<article data-testid="tweet"><div data-testid="User-Name">元の投稿者</div><div data-testid="tweetText">自分の本文 <a href="https://t.co/abc" title="https://example.com/article">参考リンク</a></div><div role="link"><div data-testid="User-Name">引用元</div><a href="/quoted/status/999"><time>引用元の日時</time></a><div data-testid="tweetText">引用の本文</div></div><a href="/owner/status/123">元の日時</a></article>',({opened,warnings})=>{
    assert.equal(warnings.length,0);assert.equal(opened.length,1);assert.equal(opened[0].url,'https://x.com/owner/status/123');assert.equal(opened[0].text,'自分の本文 参考リンク');assert.equal(opened[0].author,'元の投稿者');assert.deepEqual(opened[0].links,['https://example.com/article']);
  });
});
test('対象ポストを引用した別ポストや本文内のリンクを対象と取り違えない',()=>{
  capture('<article data-testid="tweet"><a href="/other/status/999"><time>別の日時</time></a><div data-testid="tweetText">別ポストの本文 <a href="/owner/status/123">対象へのリンク</a></div><div data-testid="quoteTweet"><a href="/owner/status/123"><time>引用の日時</time></a><div data-testid="tweetText">引用</div></div></article><article data-testid="tweet"><div data-testid="tweetText">本来の本文</div><a href="/owner/status/123">本来の日時</a></article>',({opened})=>{assert.equal(opened.length,1);assert.equal(opened[0].text,'本来の本文');});
});
test('article以外のtweetコンテナーにも対応する',()=>{
  capture('<div data-testid="tweet"><div data-testid="tweetText">divコンテナーの本文</div><a href="/owner/status/123">日時</a></div>',({opened})=>{assert.equal(opened[0].text,'divコンテナーの本文');});
});
test('固定リンクがない場合はユーザーが本文を選んでから保存する',()=>{
  capture('<article data-testid="tweet"><div data-testid="tweetText">固定リンクがない本文</div></article><article data-testid="tweet"><a href="/reply/status/999"><time>返信</time></a><div data-testid="tweetText">返信の本文</div></article>',({window,opened,warnings})=>{
    assert.equal(opened.length,0);assert.equal(warnings.length,0);const picker=window.document.querySelector('[data-postnote-picker]');assert.ok(picker);picker.querySelector('button').click();assert.equal(opened.length,1);assert.equal(opened[0].text,'固定リンクがない本文');assert.equal(opened[0].url,'https://x.com/owner/status/123');assert.equal(window.document.querySelector('[data-postnote-picker]'),null);
  });
});
test('選択画面で返信を明示的に選んだ場合は返信のURLと本文をセットで渡す',()=>{
  capture('<article data-testid="tweet"><div data-testid="tweetText">元の本文</div></article><article data-testid="tweet"><a href="/reply/status/999"><time>返信</time></a><div data-testid="tweetText">返信の本文</div></article>',({window,opened})=>{window.document.querySelectorAll('[data-postnote-picker] button')[1].click();assert.equal(opened[0].url,'https://x.com/reply/status/999');assert.equal(opened[0].text,'返信の本文');});
});
test('本文なしの引用ポストで引用元の本文を本人の本文として取得しない',()=>{
  capture('<article data-testid="tweet"><a href="/owner/status/123">日時</a><div role="link"><a href="/quoted/status/999"><time>引用の日時</time></a><div data-testid="tweetText">引用元の本文</div></div></article>',({opened})=>{assert.equal(opened[0].text,'');});
});
