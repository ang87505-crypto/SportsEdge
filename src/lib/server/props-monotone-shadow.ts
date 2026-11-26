/** Append-only real-platform shadow, inside the existing running capture transaction/lease. */
import {MONOTONE_SHADOW,modelDigest,verifiedMonotoneCalibration,monotoneShadowProbability} from '../props/monotone-shadow.ts';
import type {Stat} from '../props/contract.ts';
import type {PropsStore} from './props-store.ts';
import {PropsStoreError} from './props-store.ts';

export type ShadowBaseline={id:number;observationId:number;status:string;athleteId:string|null;
 pMore:number|null;pLess:number|null;pTie:number|null;mean:number|null;dataCutoff:string};
export type ShadowObservation={id:number;stat:Stat;lockAt:string};
export async function recordMonotoneShadows(d:{store:PropsStore;now:()=>string;model:unknown},runId:number,
 baselines:ShadowBaseline[],observations:ShadowObservation[]){
 const result={model:MONOTONE_SHADOW.model,status:'OK',written:0,skipped:0,refused:0,unknown:0,code:null as string|null};
 try{
  const now=Date.parse(d.now());
  if(!Number.isFinite(now))throw Error('MONOTONE_SHADOW_CLOCK');
  if(now<Date.parse(MONOTONE_SHADOW.notBefore))return {...result,status:'NOT_STARTED'};
  if(modelDigest(d.model)!==MONOTONE_SHADOW.baselineDigest)throw Error('MONOTONE_SHADOW_BASELINE_MISMATCH');
  const calibration=verifiedMonotoneCalibration(),obs=new Map(observations.map(o=>[o.id,o])),pending:Record<string,unknown>[]=[];
  for(const b of baselines){
   const o=obs.get(b.observationId);
   if(!o||b.status!=='scored'||!b.athleteId||[b.pMore,b.pLess,b.pTie,b.mean].some(v=>v===null)||
    !Number.isFinite(Date.parse(o.lockAt))||Date.parse(o.lockAt)<=Date.parse(d.now())||
    !Number.isFinite(Date.parse(b.dataCutoff))||Date.parse(b.dataCutoff)<Date.parse(MONOTONE_SHADOW.notBefore)||
    Date.parse(b.dataCutoff)>Date.parse(d.now())){result.skipped++;continue;}
   const p=monotoneShadowProbability(o.stat,{pMore:b.pMore!,pLess:b.pLess!,pTie:b.pTie!},calibration);
   pending.push({observation_id:b.observationId,run_id:runId,
     model_version:MONOTONE_SHADOW.model,status:'scored',reason:'research_shadow',athlete_id:b.athleteId,
     p_more:p.pMore,p_less:p.pLess,p_tie:p.pTie,mean:b.mean,data_cutoff:b.dataCutoff,
     inputs:{researchOnly:true,baselinePredictionId:b.id,calibratorDigest:MONOTONE_SHADOW.digest,
      baselineArtifactSha256:MONOTONE_SHADOW.baselineDigest}});
  }
  const insert=async(rows:Record<string,unknown>[])=>{
   // Database clock sets predicted_at and rejects any write crossing lock. Unique model/observation refuses duplicates.
   const saved=await d.store.insert('props_predictions',rows,
    {onConflict:'observation_id,model_version',ignoreDuplicates:true,select:'id'});
   result.written+=saved.length;
  };
  outer:for(let offset=0;offset<pending.length;offset+=200){
   const part=pending.slice(offset,offset+200);
   try{await insert(part);}catch(e){
    result.code=e instanceof PropsStoreError?e.code:'UNEXPECTED';
    if(!(e instanceof PropsStoreError&&e.refused)){
     // The whole batch may have committed. Stop without resubmitting any uncertain row.
     result.unknown+=part.length;break;
    }
    // A definitely rolled-back batch crossing a lock can preserve its still-open rows individually.
    if(e.code!=='PROPS_PREDICTION_AFTER_LOCK'||part.length===1){result.refused+=part.length;continue;}
    for(const row of part)try{await insert([row]);}catch(err){
     result.code=err instanceof PropsStoreError?err.code:'UNEXPECTED';
     if(err instanceof PropsStoreError&&err.refused)result.refused++;
     else{result.unknown++;break outer;}
    }
   }
  }
  if(result.refused||result.unknown)result.status='ATTENTION';
 }catch(e){result.status='BLOCKED';result.code=e instanceof Error&&/^MONOTONE_SHADOW_[A-Z_]+$/.test(e.message)?e.message:'UNEXPECTED';}
 return result;
}
