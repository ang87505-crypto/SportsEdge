/**
 * Command Center 2.0: a real multi-turn conversation against SportsEdge's own records (research/QA, read-only).
 *   node --experimental-strip-types scripts/command-real-conversation.ts
 * Uses the same handler as /api/command with the built-in planner (no AI model: no key, no budget). The props store is
 * wrapped so only `select` (HTTP GET) exists; any other call throws. Prints each turn's mode, text and card titles.
 */
import {handleCommand} from '../src/lib/server/command-handler.ts';
import {propsStore} from '../src/lib/server/props-store.ts';
import {loadPropsDashboardFrom} from '../src/lib/server/props-dashboard-load.ts';
import {loadOpsStatus} from '../src/lib/server/ops-status-load.ts';
import {loadStockResearch} from '../src/lib/server/stock-research-load.ts';
import type {PropsStore} from '../src/lib/server/props-store.ts';

const nowIso=new Date().toISOString();
const real=propsStore();
const readOnly={select:real.select.bind(real),rpc:()=>{throw new Error('READ_ONLY: rpc refused');}} as unknown as PropsStore;
let raw:Awaited<ReturnType<typeof loadPropsDashboardFrom>>|null=null;
const ports={nowIso,ownerAccess:false,
 sports:async()=>raw??=await loadPropsDashboardFrom(readOnly,nowIso),
 ops:()=>loadOpsStatus(nowIso),research:()=>loadStockResearch(nowIso),lab:async()=>null,
 accounts:async()=>{throw new Error('owner loader must not run');}};
const turns=['How did our picks do yesterday?','which ones missed?','and this week?','How does that compare with last week?','Virtual bankroll','Show job health','Show stock strategies'];
let session:unknown=undefined;const history:{role:string;text:string}[]=[];let i=0;
for(const message of turns){
 const res=await handleCommand({contentType:'application/json',text:async()=>JSON.stringify({message,history,...(session?{session}:{})}),clientKey:'real-'+(i++)},{},
  {ports,legacy:async()=>null});
 const b=await res.json() as {status:string;mode:string;reply:{text:string;cards:{kind:string;title?:string}[]};session:unknown};
 console.log(`\nQ: ${message}\n[${res.status} ${b.mode}] ${b.reply?.text}\ncards: ${(b.reply?.cards??[]).map(c=>c.title??c.kind).join(' | ')}`);
 session=b.session;history.push({role:'user',text:message},{role:'assistant',text:b.reply?.text??''});
}
