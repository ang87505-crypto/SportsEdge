/**
 * Scheduler reliability analysis (pure, read-only): for each possible slate anchor tip-off, does at least one Vercel
 * backup tick land inside the capture window for EVERY start delay in the observed range? Used to judge whether the
 * backup cadence alone (with every GitHub schedule dropped) can carry the props capture. Changes no schedule.
 */
import {CAPTURE_PLAN_V1} from './capture-plan.ts';

export type CoverageInput={backupHoursUtc:number[];delayMin:{min:number;max:number};
 window?:{fromMin:number;toMin:number};tipFromMin:number;tipToMin:number;stepMin?:number};
export type CoverageGap={fromTipUtc:string;toTipUtc:string};

const hhmm=(m:number)=>{const x=((m%1440)+1440)%1440;return `${String(Math.floor(x/60)).padStart(2,'0')}:${String(x%60).padStart(2,'0')}`;};

/** A tip at minute T (may exceed 1440 for after-midnight UTC tips) is guaranteed if some backup b has
 * b+min >= T-from and b+max <= T-to, i.e. its whole delay range lands inside [T-from, T-to]. */
export function guaranteed(tipMin:number,x:CoverageInput):boolean{
 const w=x.window??CAPTURE_PLAN_V1.windows.late;
 const backups=x.backupHoursUtc.flatMap(h=>[h*60-1440,h*60,h*60+1440]);
 return backups.some(b=>b+x.delayMin.min>=tipMin-w.fromMin&&b+x.delayMin.max<=tipMin-w.toMin);
}

export function coverageGaps(x:CoverageInput):{gaps:CoverageGap[];checked:number;uncovered:number;worstGapBetweenBackupsMin:number}{
 const step=x.stepMin??5,gaps:CoverageGap[]=[];let start:number|null=null,checked=0,uncovered=0;
 for(let t=x.tipFromMin;t<=x.tipToMin;t+=step){
  checked++;
  const ok=guaranteed(t,x);
  if(!ok){uncovered++;if(start===null)start=t;}
  if((ok||t+step>x.tipToMin)&&start!==null){gaps.push({fromTipUtc:hhmm(start),toTipUtc:hhmm(ok?t-step:t)});start=null;}
 }
 const hs=[...x.backupHoursUtc].sort((a,b)=>a-b);
 const spacing=hs.map((h,i)=>((hs[(i+1)%hs.length]-h+24)%24||24)*60);
 return {gaps,checked,uncovered,worstGapBetweenBackupsMin:Math.max(...spacing)+x.delayMin.max-x.delayMin.min};
}
