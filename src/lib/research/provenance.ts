/**
 * AI 2.0 research intake: provenance for every research item. Pure; no I/O.
 * An item may feed a point-in-time backtest or a frozen forecast only if it is from a registered, connected (or
 * implemented) source, its checksum matches its content, and it was AVAILABLE before the decision cutoff. A missing
 * or unparseable availability time excludes it from point-in-time use. Literature never enters features; it can
 * only suggest a hypothesis for the engine to register and test.
 */
import {canonicalJson,sha256} from '../props/normalize.ts';
import {sourceById,type Reliability} from './sources.ts';

export type IntendedUse='point-in-time-feature'|'grading'|'hypothesis-only';
export type ProvenanceRecord={sourceId:string;sourceItemId:string;originalUrl:string;retrievedAt:string;
 /** When the information became publicly available (publication/acceptance). null when unknown. */
 availableAt:string|null;eventDate:string|null;reliability:Reliability;checksumSha256:string;intendedUse:IntendedUse;content:unknown};

export type ProvenanceVerdict={usable:boolean;pointInTime:boolean;reasons:string[]};

export const checksum=(content:unknown)=>sha256(canonicalJson(content));

/** Validate a record; for point-in-time use also require availability strictly before `cutoff`. */
export function verify(r:ProvenanceRecord,cutoffIso:string|null=null):ProvenanceVerdict{
 const reasons:string[]=[];
 const src=sourceById(r.sourceId);
 if(!src)reasons.push('UNREGISTERED_SOURCE');
 else if(src.status==='blocked'||src.status==='proposed')reasons.push('SOURCE_NOT_APPROVED_'+src.status.toUpperCase());
 if(src&&src.reliability!==r.reliability)reasons.push('RELIABILITY_MISMATCH');
 const literature=r.sourceId==='openalex'||r.sourceId==='arxiv';
 if(literature&&r.intendedUse!=='hypothesis-only')reasons.push('LITERATURE_NEVER_A_FEATURE');
 try{
  const u=new URL(r.originalUrl),hosts:Record<string,string[]>={'openalex':['openalex.org','doi.org'],'arxiv':['arxiv.org'],
   'sec-edgar-companyfacts':['data.sec.gov','www.sec.gov'],'sec-edgar-13f':['data.sec.gov','www.sec.gov']};
  if(u.protocol!=='https:'||u.username||u.password||(hosts[r.sourceId]&&!hosts[r.sourceId].includes(u.hostname)))reasons.push('UNTRUSTED_SOURCE_URL');
 }catch{reasons.push('UNTRUSTED_SOURCE_URL');}
 if(!r.sourceItemId||!r.originalUrl)reasons.push('MISSING_IDENTIFIER');
 if(!Number.isFinite(Date.parse(r.retrievedAt)))reasons.push('BAD_RETRIEVED_AT');
 if(checksum(r.content)!==r.checksumSha256)reasons.push('CHECKSUM_MISMATCH');
 const avail=r.availableAt!==null&&Number.isFinite(Date.parse(r.availableAt))?Date.parse(r.availableAt):null;
 if(r.availableAt!==null&&avail===null)reasons.push('BAD_AVAILABILITY_TIME');
 if(avail!==null&&Number.isFinite(Date.parse(r.retrievedAt))&&avail>Date.parse(r.retrievedAt))reasons.push('AVAILABLE_AFTER_RETRIEVAL');
 const usable=!reasons.length;
 let pointInTime=usable&&r.intendedUse==='point-in-time-feature';
 if(pointInTime){
  if(avail===null){reasons.push('NO_AVAILABILITY_TIME');pointInTime=false;}
  else if(!cutoffIso||!(avail<Date.parse(cutoffIso))){reasons.push('NOT_AVAILABLE_BEFORE_CUTOFF');pointInTime=false;}
 }
 if(r.intendedUse==='hypothesis-only'&&cutoffIso)reasons.push('LITERATURE_NEVER_A_FEATURE');
 return {usable,pointInTime,reasons};
}

/** Build a record with its checksum computed from the content. */
export function record(x:Omit<ProvenanceRecord,'checksumSha256'>):ProvenanceRecord{return {...x,checksumSha256:checksum(x.content)};}
