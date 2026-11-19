import 'server-only';
import {connection} from 'next/server';
import {StatusDot,type Tone} from '@/components/ui';
import {AskButton} from '@/components/assistant-chat';
import {loadBriefing} from '@/lib/server/briefing-load';
import {loadLab} from '@/lib/server/lab-load';
import {mtShort} from '@/lib/props/summary';

const money=(c:number,signed=false)=>(c<0?'−':signed&&c>0?'+':'')+'$'+(Math.abs(c)/100).toFixed(2);

/** The always-visible summary above the conversation. Each item asks the assistant for its full, record-backed answer. */
export async function CommandStrip(){
 await connection();
 const [b,lab]=await Promise.all([loadBriefing(),loadLab().catch(()=>null)]);
 const pp=b.money.prizepicks;
 const items:{label:string;value:string;detail:string;tone:Tone;ask:string}[]=[
  {label:'Automation',value:b.health.headline,detail:b.health.detail,tone:b.health.tone,ask:'Is everything running?'},
  {label:'Virtual P&L',value:pp?money(pp.netCents,true):'Unavailable',tone:pp?(pp.netCents>0?'positive':pp.netCents<0?'negative':'neutral'):'warning',
   detail:pp?`PrizePicks · balance ${money(pp.balanceCents)} · 7 days ${money(pp.weekNetCents,true)}. Stock PAPER is owner-only.`:'The props ledger could not be read; nothing is assumed.',ask:'How much did we make yesterday?'},
  {label:'Active models',value:lab?.active?.version??'Unknown',tone:'info',
   detail:lab?`${lab.testing.productionShadows.length} production challenger(s) + ${lab.testing.labVariants} lab variants under test`:'Learning Lab records unavailable',ask:'What did our AI learn?'},
  {label:'Next',value:b.next[0]?b.next[0].what:'Nothing planned',tone:'neutral',detail:b.next[0]?`${mtShort(b.next[0].at)} (planned, not yet run)`:'No planned times available',ask:'What happens next?'},
  {label:'Needs you',value:b.approvals.length?`${b.approvals.length} item${b.approvals.length===1?'':'s'}`:'Nothing',tone:b.approvals.length?'warning':'positive',
   detail:b.approvals[0]?.text??'No owner approval is waiting.',ask:'What requires my approval?'},
 ];
 return <ul className="command-strip" aria-label="Summary">
  {items.map(i=><li key={i.label}>
   <AskButton question={i.ask} className="command-strip-item">
    <span className="command-strip-label"><StatusDot tone={i.tone}/>{i.label}</span>
    <strong>{i.value}</strong>
    <small>{i.detail}</small>
   </AskButton>
  </li>)}
 </ul>;
}
