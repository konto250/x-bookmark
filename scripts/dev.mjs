import { createServer as createViteServer, loadEnv } from 'vite';
import http from 'node:http';
Object.assign(process.env, loadEnv('development', process.cwd(), ''));
const { default: analyze } = await import('../api/analyze.js');
const vite = await createViteServer({server: {middlewareMode: true}, appType: 'spa'});
const server = http.createServer((req,res) => {
  if (req.url?.split('?')[0] === '/api/analyze') analyze(req,res).catch(() => {res.statusCode = 500; res.end('サーバーエラー');});
  else vite.middlewares(req,res);
});
server.listen(5173,'127.0.0.1',()=>console.log('ローカルプレビュー: http://127.0.0.1:5173'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await vite.close(); server.close(); process.exit();});
