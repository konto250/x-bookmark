import { createServer as createViteServer, loadEnv } from 'vite';
import http from 'node:http';
Object.assign(process.env, loadEnv('development', process.cwd(), ''));
const { default: analyze } = await import('../api/analyze.js');
const { default: session } = await import('../api/session.js');
const { accessResponse } = await import('../server/access.js');
const vite = await createViteServer({server: {middlewareMode: true}, appType: 'spa'});
const server = http.createServer(async (req,res) => {
  const path=req.url?.split('?')[0];
  const blocked=accessResponse(new Request(new URL(req.url,'http://127.0.0.1:5173'),{method:req.method,headers:req.headers}));
  if(blocked) {res.statusCode=blocked.status;blocked.headers.forEach((value,key)=>res.setHeader(key,value));res.end(await blocked.text());return;}
  res.setHeader('Cache-Control','private, no-store');
  const handler=path === '/api/session' ? session : path === '/api/analyze' ? analyze : null;
  if(handler) handler(req,res).catch(() => {res.statusCode = 500; res.end('サーバーエラー');});
  else vite.middlewares(req,res);
});
server.listen(5173,'127.0.0.1',()=>console.log('ローカルプレビュー: http://127.0.0.1:5173'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await vite.close(); server.close(); process.exit();});
