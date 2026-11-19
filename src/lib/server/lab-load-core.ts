/**
 * Learning Lab loader core: forward lab reports/events and the production model state from the props ledger.
 * Read-only. Each source fails on its own and is reported as unavailable or not migrated, never as zero.
 */
import type {PropsStore} from './props-store.ts';
import {PropsStoreError} from './props-store.ts';
import {loadActiveModel} from './props-active-model.ts';
import {buildLabView,type LabInput,type RetroReport,type RetroStaking,type ForwardReport,type ForwardStaking,type LabEvent} from '../lab/view.ts';

const EXP='lab-sports-ablation-v1';
const missing=(e:unknown)=>e instanceof PropsStoreError&&/^(DB_42P01|STORE_HTTP_404|DB_PGRST\w*)$/.test(e.code);

export async function loadLabFrom(store:PropsStore|null,nowIso:string,retro:RetroReport,retroStaking:RetroStaking|null,stocks:LabInput['stocks']=null){
 let forward:LabInput['forward']={state:store?'unavailable':'not_configured',report:null,staking:null,events:[]};
 let production:LabInput['production']=null;
 if(store){
  try{
   const [reports,staking,events]=await Promise.all([
    store.select<{report:ForwardReport}>('props_lab_reports','select=report&experiment_id=eq.'+EXP+'&kind=eq.forward_comparison&order=id.desc&limit=1'),
    store.select<{report:ForwardStaking}>('props_lab_reports','select=report&experiment_id=eq.'+EXP+'&kind=eq.forward_staking&order=id.desc&limit=1'),
    store.select<LabEvent>('props_lab_events','select=event,detail,at&experiment_id=eq.'+EXP+'&order=id.desc&limit=60')]);
   forward={state:'ready',report:reports[0]?.report??null,staking:staking[0]?.report??null,events};
  }catch(e){forward={state:missing(e)?'not_migrated':'unavailable',report:null,staking:null,events:[]};}
  try{
   const [active,events]=await Promise.all([loadActiveModel(store),
    store.select<{version:string;event:string;reason:string;at:string;detail:Record<string,unknown>}>('props_model_events','select=version,event,reason,at,detail&order=id.desc&limit=30')]);
   production={active:active.version,learningEnabled:active.learningEnabled,autoSwitchEnabled:active.autoSwitchEnabled,shadows:active.shadows.map(s=>s.version),events};
  }catch{production=null;}
 }
 return buildLabView({nowIso,retro,retroStaking,forward,production,stocks});
}
