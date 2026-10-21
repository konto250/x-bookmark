import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// 本番バンドルから実際の登録用コードを取り出し、ソース版だけでなく圧縮後も検証する。
const index=readFileSync('dist/index.html','utf8');
const script=index.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
const app=new JSDOM('<div id="app"></div><div id="toast"></div>',{url:'https://x-bookmark-lemon.vercel.app',runScripts:'outside-only'});
app.window.fetch=async()=>({ok:true,json:async()=>({configured:false})});
try {
  app.window.eval(readFileSync('dist'+script,'utf8'));
  await new Promise(resolve=>setTimeout(resolve,0));
  const code=app.window.document.querySelector('#bookmarklet').getAttribute('href');
  const x=new JSDOM('<article data-testid="tweet"><div data-testid="tweetText">本番コードの本文取得テスト</div><a href="/test/status/123">午後3:00</a></article>',{url:'https://x.com/test/status/123',runScripts:'outside-only'});
  try {
    let opened;x.window.open=url=>opened=url;
    x.window.eval(code.slice(11));
    assert.ok(opened);const url=new URL(opened);assert.equal(url.origin,'https://x-bookmark-lemon.vercel.app');
    assert.equal(JSON.parse(decodeURIComponent(url.hash.slice(9))).text,'本番コードの本文取得テスト');
    console.log('本番バンドルのブックマークレット: 本文取得・本番URLへの受け渡し成功');
  } finally {x.window.close();}
}finally{app.window.close();}
