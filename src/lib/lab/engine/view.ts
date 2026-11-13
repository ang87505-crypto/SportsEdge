/**
 * /lab view of the learning engine registry. Pure; reads only the recorded registry passed in.
 * Shows what is being tested, what is waiting for evidence, what is ready for owner review (never auto-promoted),
 * and why ideas were rejected, separately for sports and stocks.
 */
import {STATUSES,type Registry,type Status} from './experiments.ts';
import {SOURCE_REGISTER,type SourceStatus} from '../../research/sources.ts';

export type EngineView={counts:Record<'sports'|'stocks',Record<Status,number>>;
 readyForReview:{id:string;domain:string;hypothesis:string;why:string}[];
 collecting:{id:string;domain:string;status:Status;why:string}[];
 rejected:{id:string;domain:string;why:string}[];
 sources:Record<SourceStatus,string[]>;total:number};

const lastReason=(e:Registry['experiments'][number])=>e.history.at(-1)?.reason??e.disposition??'';

export function engineView(reg:Registry):EngineView{
 const zero=()=>Object.fromEntries(STATUSES.map(s=>[s,0])) as Record<Status,number>;
 const counts={sports:zero(),stocks:zero()};
 for(const e of reg.experiments)counts[e.domain][e.status]++;
 const by=(f:(s:Status)=>boolean)=>reg.experiments.filter(e=>f(e.status));
 const sources={connected:[],implemented:[],proposed:[],blocked:[]} as Record<SourceStatus,string[]>;
 for(const s of SOURCE_REGISTER)sources[s.status].push(s.id);
 return {counts,total:reg.experiments.length,
  readyForReview:by(s=>s==='READY_FOR_REVIEW').map(e=>({id:e.id,domain:e.domain,hypothesis:e.hypothesis,why:lastReason(e)})),
  collecting:by(s=>['PROPOSED','RUNNING','INSUFFICIENT_DATA','PROMISING','FAILED'].includes(s)).map(e=>({id:e.id,domain:e.domain,status:e.status,why:e.disposition??lastReason(e)})),
  rejected:by(s=>s==='REJECTED').map(e=>({id:e.id,domain:e.domain,why:e.disposition??lastReason(e)})),sources};
}
