import type {NextRequest} from 'next/server';
import {createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {handleSiteAssistant,sitePorts} from '@/lib/server/site-assistant-handler';
import {handleCommand} from '@/lib/server/command-handler';
import {cachedPropsRaw} from '@/lib/server/assistant-handler';
import {loadPropsDashboardFrom} from '@/lib/server/props-dashboard-load';
import {propsStore,propsStoreConfig} from '@/lib/server/props-store';
import {OWNER_COOKIE,ownerSecret} from '@/lib/server/alpaca-owner-session';
import {supabaseLedger} from '@/lib/server/command-ledger';
import {anthropicModel} from '@/lib/command/llm';
import {llmConfig} from '@/lib/command/budget';
import type {Reply} from '@/lib/assistant/answer';

export const maxDuration=30;
/** Command Center 2.0 (read-only). Messages are not stored. The optional AI model is off unless configured by the owner. */
export async function POST(req:NextRequest){
 const nowIso=new Date().toISOString(),env=process.env;
 const cookie=req.cookies.get(OWNER_COOKIE)?.value;
 const siteReq={url:req.url,contentType:'application/json',origin:req.headers.get('origin'),ownerCookie:cookie,text:async()=>''};
 const sports=(now:string)=>loadPropsDashboardFrom(propsStore(),now);
 const site=sitePorts(siteReq,env,sports);
 const propsConfigured=env.SPORTSEDGE_PREVIEW_FIXTURES!=='1'&&(()=>{try{propsStoreConfig(env);return true;}catch{return false;}})();
 const ip=req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
 const clientKey=createHash('sha256').update(cookie?'o:'+cookie:'ip:'+ip).digest('hex').slice(0,32);
 const cfg=llmConfig(env);
 return handleCommand({contentType:req.headers.get('content-type'),text:()=>req.text(),clientKey},env,{
  ports:{nowIso,ownerAccess:site.access.ownerAccess,
   sports:()=>propsConfigured?cachedPropsRaw(sports,nowIso):Promise.resolve(null),
   ops:()=>site.ops?site.ops(nowIso):Promise.resolve(null),research:()=>site.research(nowIso),lab:()=>site.lab?site.lab(nowIso):Promise.resolve(null),
   accounts:()=>site.accounts(),
   // Learning-engine records ship with the AI 2.0 research work; until deployed, the files are absent and the tool says so.
   engine:async()=>{try{const [registry,jobs]=await Promise.all(['registry','jobs'].map(async f=>JSON.parse(await readFile(join(process.cwd(),'research/engine',f+'.json'),'utf8'))));return {registry,jobs};}catch{return null;}}},
  async legacy(message,context){
   const r=await handleSiteAssistant({contentType:'application/json',text:async()=>JSON.stringify({message:message.slice(0,300),context})},env,nowIso,site);
   const b=await r.json().catch(()=>null) as {reply?:Reply}|null;
   return b?.reply??null;
  },
  model:cfg?()=>anthropicModel(cfg.model,env.ANTHROPIC_API_KEY!):undefined,
  ledger:c=>supabaseLedger(env,c.dailyCapUsd,c.perMinute),
  historyKey:(()=>{const s=ownerSecret();return s?createHmac('sha256',s).update('command-history-key-v1').digest('hex'):null;})()});
}
