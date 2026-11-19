/**
 * Which model the collect run uses, and which challengers shadow it. SERVER/WORKER ONLY.
 * Every learning artifact is re-verified (SHA-256 of canonical JSON and shape) on every read;
 * anything unverifiable falls back to layer 1 and is reported, never silently used.
 * If the learning tables are not migrated yet, layer 1 is used and the control is reported unavailable.
 */
import type {PropsStore} from './props-store.ts';
import {FEATURES,artifactSha256,type LearnArtifact} from '../props/learn.ts';
import {MODEL_VERSION,STATS} from '../props/contract.ts';

export const LAYER1_VERSION=MODEL_VERSION;
export const MAX_SHADOWING=3;
export type ActiveModel={version:string;artifact:LearnArtifact|null;fallback:boolean;controlAvailable:boolean;
 shadows:{version:string;artifact:LearnArtifact}[];learningEnabled:boolean;autoSwitchEnabled:boolean};

const SHADOWING=new Set(['shadow_start','eligible']);
type ArtifactRow={version:string;sha256:string;artifact:unknown};

/** The artifact, if its hash and shape check out; otherwise null. */
export function verifiedArtifact(r:ArtifactRow|undefined):LearnArtifact|null{
 if(!r||!r.artifact||typeof r.artifact!=='object')return null;
 const a=r.artifact as LearnArtifact;
 if(a.modelVersion!==r.version||artifactSha256(a)!==r.sha256)return null;
 const ok=STATS.every(s=>Array.isArray(a.weights?.[s])&&a.weights[s].length===FEATURES.length&&a.weights[s].every(Number.isFinite));
 return ok?a:null;
}

export async function loadActiveModel(store:PropsStore):Promise<ActiveModel>{
 const layer1:ActiveModel={version:LAYER1_VERSION,artifact:null,fallback:false,controlAvailable:false,shadows:[],learningEnabled:false,autoSwitchEnabled:false};
 let control:{active_model_version:string;learning_enabled:boolean;auto_switch_enabled:boolean}|undefined;
 let events:{id:number;version:string;event:string}[];
 try{
  [[control],events]=await Promise.all([
   store.select<NonNullable<typeof control>>('props_model_control','select=active_model_version,learning_enabled,auto_switch_enabled'),
   store.select<{id:number;version:string;event:string}>('props_model_events','select=id,version,event&order=id.desc&limit=1000')]);
 }catch{return layer1;}
 if(!control)return layer1;
 const base={controlAvailable:true,learningEnabled:control.learning_enabled,autoSwitchEnabled:control.auto_switch_enabled};
 const latest=new Map<string,{id:number;event:string}>();
 for(const e of events){const l=latest.get(e.version);if(!l||e.id>l.id)latest.set(e.version,e);}
 // An eligible challenger keeps shadowing until it is promoted, so its evidence stays current.
 const shadowVersions=[...latest.entries()].filter(([v,e])=>SHADOWING.has(e.event)&&v!==control!.active_model_version)
  .sort((a,b)=>b[1].id-a[1].id).slice(0,MAX_SHADOWING).map(([v])=>v);
 const wanted=[...new Set([...shadowVersions,...(control.active_model_version===LAYER1_VERSION?[]:[control.active_model_version])])];
 let artifacts:ArtifactRow[]=[];
 try{
  if(wanted.length)artifacts=await store.select<ArtifactRow>('props_model_artifacts',
   'select=version,sha256,artifact&version=in.('+wanted.map(v=>'"'+v+'"').join(',')+')');
 }catch{return {...layer1,...base,fallback:control.active_model_version!==LAYER1_VERSION};}
 const byVersion=new Map(artifacts.map(a=>[a.version,a]));
 const shadows=shadowVersions.flatMap(version=>{const artifact=verifiedArtifact(byVersion.get(version));return artifact?[{version,artifact}]:[];});
 if(control.active_model_version===LAYER1_VERSION)return {...layer1,...base,shadows};
 const artifact=verifiedArtifact(byVersion.get(control.active_model_version));
 if(!artifact)return {...layer1,...base,fallback:true,shadows};
 return {version:control.active_model_version,artifact,fallback:false,...base,shadows};
}
