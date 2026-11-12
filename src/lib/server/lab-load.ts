/** Learning Lab view for the page, the homepage strip and the assistant. Read-only; one read per call. */
import {propsStore,propsStoreConfig} from './props-store.ts';
import {loadLabFrom} from './lab-load-core.ts';
import type {RetroReport,RetroStaking,LabView} from '../lab/view.ts';
import retro from '../../../research/lab_sports_ablation_20261112/report.json' with {type:'json'};
import retroStaking from '../../../research/lab_staking_20261112/report.json' with {type:'json'};
import {stockLabSummary} from '../lab/stocks-summary.ts';
import {loadStockResearch} from './stock-research-load.ts';

export function labStoreConfigured(env:Readonly<Record<string,string|undefined>>=process.env){
 if(env.SPORTSEDGE_PREVIEW_FIXTURES==='1')return false;
 try{propsStoreConfig(env);return true;}catch{return false;}
}
export async function loadLab(nowIso:string=new Date().toISOString()):Promise<LabView>{
 const research=await loadStockResearch(nowIso).catch(()=>null);
 return loadLabFrom(labStoreConfigured()?propsStore():null,nowIso,retro as unknown as RetroReport,retroStaking as unknown as RetroStaking,stockLabSummary(research));
}
