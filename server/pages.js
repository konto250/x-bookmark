import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import { load } from 'cheerio';

export function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export async function validateTarget(value, resolver = lookup) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('この形式のURLは取得できません。');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || /\.(localhost|local|internal)$/i.test(hostname)) throw new Error('公開ページだけを取得できます。');
  const addresses = await resolver(hostname, {all: true, verbatim: true});
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('公開ページだけを取得できます。');
  return {url, address: addresses[0]};
}

async function download(value, signal, redirects = 0) {
  if (redirects > 4) throw new Error('リダイレクトが多いため取得できませんでした。');
  const {url, address} = await validateTarget(value);
  signal.throwIfAborted();
  const result = await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(url, {
      signal,
      // 検証したIPに固定し、DNSの再解決による内部ネットワークへの接続を防ぐ。
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      headers: {'User-Agent': 'Postnote/1.0 (bookmark link preview)', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity'}
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        const location = res.headers.location;
        res.destroy();
        return location ? resolve({redirect: new URL(location, url).href}) : reject(new Error('転送先が不明です。'));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {res.destroy(); return reject(new Error(`取得できませんでした（HTTP ${res.statusCode}）。`));}
      if (!/^(text\/html|application\/xhtml\+xml)/i.test(res.headers['content-type'] || '')) {res.destroy(); return reject(new Error('HTML以外のファイルは解析できません。'));}
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {res.destroy(); return reject(new Error('ページの圧縮形式に対応していません。'));}
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 1_000_000) {res.destroy(); reject(new Error('ページサイズが上限を超えました。'));}
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const charset = (res.headers['content-type'] || '').match(/charset=["']?([^\s;"']+)/i)?.[1] || 'utf-8';
        let html;
        try {html = new TextDecoder(charset).decode(Buffer.concat(chunks));} catch {html = Buffer.concat(chunks).toString('utf8');}
        resolve({html, url: url.href});
      });
    });
    req.on('error', reject);
  });
  return result.redirect ? download(result.redirect, signal, redirects + 1) : result;
}

export function parsePage(html, url) {
  const $ = load(html);
  const clean = s => s.replace(/\s+/g, ' ').trim();
  const title = clean($('meta[property="og:title"]').attr('content') || $('title').text()).slice(0,300);
  const description = clean($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').slice(0,500);
  $('script,style,noscript,nav,footer,header,aside,form,iframe,svg').remove();
  const main = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  return {url, title, description, text: clean(main.text()).slice(0,10000), status: 'ok'};
}

export async function inspectPage(url) {
  try {
    const signal = AbortSignal.timeout(8000);
    const result = await Promise.race([download(url, signal), new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}))]);
    return parsePage(result.html, result.url);
  } catch (error) {
    const message = error.name === 'TimeoutError' || error.name === 'AbortError' ? '時間内に取得できませんでした。' : error.message;
    return {url, status: 'error', title: '', description: '', error: message.includes('公開ページ') || message.includes('できません') || message.includes('上限') || message.includes('対応していません') ? message : 'ページに接続できませんでした。'};
  }
}
