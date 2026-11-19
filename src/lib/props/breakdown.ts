/**
 * Forward pick performance broken down by stat, stated-confidence band, side and model version, from graded
 * recorded picks only (voids and pending lines are excluded and counted separately). Pure. Every group carries its
 * sample size and a 95% Wilson interval; groups under MIN_GROUP are labelled too small to read.
 */
import type {PropsView} from './dashboard-view.ts';
import {wilsonUpper} from './brake.ts';

export const MIN_GROUP=30;
export type Group={key:string;label:string;n:number;hits:number;hitRate:number|null;meanConfidence:number|null;
 /** Stated confidence minus hit rate: positive = overconfident. */
 gap:number|null;low:number|null;high:number|null;tooSmall:boolean};
export type Breakdown={graded:number;pending:number;voided:number;byStat:Group[];byBand:Group[];bySide:Group[];byModel:Group[];
 /** Recorded entries whose two legs share a game (the entry rule forbids it; reported so a breach is visible). */
 sameGameEntries:number;note:string};

const BANDS:[number,number,string][]=[[0,0.65,'Under 65%'],[0.65,0.70,'65–70%'],[0.70,0.75,'70–75%'],[0.75,1.01,'75% and up']];
const wilsonLow=(k:number,n:number)=>n?1-wilsonUpper(n-k,n):null;
const modelName=(v:string)=>v==='props-nb-minutes-rate-v1'?'Stats model':v.replace(/^props-learn-v/,'Learning model v');

function group(key:string,label:string,rows:{correct:boolean;conf:number}[]):Group{
 const n=rows.length,hits=rows.filter(r=>r.correct).length;
 const hitRate=n?hits/n:null,mean=n?rows.reduce((a,r)=>a+r.conf,0)/n:null;
 return {key,label,n,hits,hitRate,meanConfidence:mean,gap:hitRate===null||mean===null?null:mean-hitRate,
  low:n?wilsonLow(hits,n):null,high:n?wilsonUpper(hits,n):null,tooSmall:n<MIN_GROUP};
}
function by<T extends string>(rows:R[],keyOf:(r:R)=>T,labelOf:(k:T)=>string,order?:T[]):Group[]{
 const m=new Map<T,R[]>();
 for(const r of rows){const k=keyOf(r);m.set(k,[...(m.get(k)??[]),r]);}
 const keys=order?order.filter(k=>m.has(k)):[...m.keys()].sort();
 return keys.map(k=>group(k,labelOf(k),m.get(k)!));
}
type R={correct:boolean;conf:number;stat:string;side:string;model:string};

export function breakdown(v:PropsView):Breakdown{
 const recorded=v.lines.filter(l=>l.decision==='recorded'&&l.side);
 const rows:R[]=recorded.filter(l=>l.correct!==null&&(l.side==='more'?l.pMore:l.pLess)!==null).map(l=>({correct:l.correct!,
  conf:(l.side==='more'?l.pMore:l.pLess)!,stat:l.stat,side:l.side!,model:l.modelVersion??'unknown'}));
 const sameGame=v.entries.filter(e=>e.legs.length>1&&new Set(e.legs.map(l=>l.game)).size<e.legs.length).length;
 const small=rows.length<MIN_GROUP*4;
 return {graded:rows.length,pending:v.accuracy.pending,voided:v.accuracy.voided,
  byStat:by(rows,r=>r.stat,k=>k[0].toUpperCase()+k.slice(1),['points','rebounds','assists']),
  byBand:by(rows,r=>BANDS.find(([lo,hi])=>r.conf>=lo&&r.conf<hi)?.[2]??'Other',k=>k,BANDS.map(b=>b[2])),
  bySide:by(rows,r=>r.side,k=>k==='more'?'More':'Less',['more','less']),
  byModel:by(rows,r=>r.model,modelName),
  sameGameEntries:sameGame,
  note:rows.length===0?'No graded picks yet.':small?`${rows.length} graded picks in total: every group is small, so differences between groups can be chance. Nothing here changes the model; challengers are judged only by their registered forward tests.`:
   'Groups under '+MIN_GROUP+' graded picks are marked too small to read. Nothing here changes the model.'};
}
