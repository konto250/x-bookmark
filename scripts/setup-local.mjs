import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnv } from 'vite';
const file = '.env.local';
if(!existsSync(file)) writeFileSync(file, '# このファイルはGit管理対象外です。キーは引用符なしで入力してください。\nOPENAI_API_KEY=\nOPENAI_MODEL=gpt-4.1-mini\n', {flag:'wx'});
const env = loadEnv('development',process.cwd(),'');
if(!env.APP_ACCESS_TOKEN) {
  const source=readFileSync(file,'utf8');
  const entry=`APP_ACCESS_TOKEN=${randomBytes(24).toString('base64url')}`;
  writeFileSync(file, /^APP_ACCESS_TOKEN=.*$/m.test(source) ? source.replace(/^APP_ACCESS_TOKEN=.*$/m,entry) : source+'\n# アプリのAI設定に入力するアクセスコード\n'+entry+'\n');
}
mkdirSync('.local',{recursive:true});
console.log(JSON.stringify({envFile:file,openaiKeyConfigured:Boolean(env.OPENAI_API_KEY),accessCodeConfigured:true}));
