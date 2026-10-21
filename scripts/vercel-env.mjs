import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { loadEnv } from 'vite';

// npm exec --package=vercel -c "node scripts/vercel-env.mjs" で実行する。
// シークレットは標準入力だけで渡し、引数・標準出力に含めない。
const cli = process.env.PATH.split(delimiter).map(dir=>resolve(dir,'../vercel/dist/index.js')).find(existsSync);
if(!cli || !existsSync('.vercel/project.json')) throw new Error('Vercel CLIとプロジェクトの接続が必要です。');
const env=loadEnv('development',process.cwd(),'');
for(const name of process.argv.includes('--model-only') ? ['OPENAI_MODEL'] : ['OPENAI_API_KEY','APP_ACCESS_TOKEN','OPENAI_MODEL']) {
  if(!env[name]) throw new Error(`${name}が未設定です。`);
  const result=await new Promise((done,reject)=>{
    const proc=spawn(process.execPath,[cli,'env','add',name,'production','--force'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    proc.on('error',reject);proc.stdout.resume();proc.stderr.resume();
    proc.on('close',code=>done(code));proc.stdin.end(env[name]);
  });
  if(result!==0) throw new Error(`${name}のVercelへの設定に失敗しました。値は表示していません。`);
  console.log(`${name}: 本番環境へ設定済み`);
}
