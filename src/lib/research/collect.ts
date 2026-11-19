/**
 * AI 2.0 research intake: pure checks applied to every collected dataset before it may be used. No I/O.
 * - SEC ticker→CIK map parsing (the SEC's own company_tickers.json; a CURRENT list, so never survivorship-free)
 * - point-in-time validation of company facts (no fact filed before its period ended, none filed after retrieval,
 *   and the as-of lookup never returns a fact that was not yet public)
 * - quality report (coverage per tag, dropped rows, restatements, freshness)
 * - dataset version: a checksum over the sorted item checksums, so an identical re-collection is detected as a duplicate
 */
import {asOf,type PitFact} from './sec-companyfacts.ts';
import {checksum} from './provenance.ts';

export function parseTickerMap(body:unknown):Map<string,string>{
 const m=new Map<string,string>();
 if(!body||typeof body!=='object')return m;
 for(const v of Object.values(body as Record<string,unknown>)){
  const x=v as {cik_str?:unknown;ticker?:unknown};
  if((typeof x?.cik_str==='number'||typeof x?.cik_str==='string')&&typeof x.ticker==='string'&&/^[A-Z][A-Z0-9.-]{0,9}$/.test(x.ticker)&&/^\d{1,10}$/.test(String(x.cik_str)))
   if(!m.has(x.ticker))m.set(x.ticker,String(x.cik_str).padStart(10,'0'));
 }
 return m;
}

export type PitCheck={ok:boolean;facts:number;filedBeforePeriodEnd:number;filedAfterRetrieval:number;asOfLeaks:number;cutoffsChecked:number};
/** Point-in-time validation. `cutoffs` are decision days (YYYY-MM-DD) at which the as-of lookup is exercised. */
export function validatePointInTime(facts:PitFact[],retrievedDay:string,cutoffs:string[]):PitCheck{
 let before=0,after=0,leaks=0,checked=0;
 for(const f of facts){if(f.filed<f.periodEnd)before++;if(f.filed>retrievedDay)after++;}
 const tags=[...new Set(facts.map(f=>f.tag))];
 for(const day of cutoffs)for(const tag of tags){checked++;const v=asOf(facts,tag,day);if(v&&!(v.filed<day))leaks++;}
 return {ok:!before&&!after&&!leaks,facts:facts.length,filedBeforePeriodEnd:before,filedAfterRetrieval:after,asOfLeaks:leaks,cutoffsChecked:checked};
}

export function qualityReport(facts:PitFact[],dropped:number,retrievedDay:string){
 const byTag:Record<string,number>={};let restated=0;const seen=new Map<string,number>();
 for(const f of facts){byTag[f.tag]=(byTag[f.tag]??0)+1;const k=f.tag+'|'+f.unit+'|'+f.periodEnd;seen.set(k,(seen.get(k)??0)+1);}
 for(const n of seen.values())if(n>1)restated++;
 const latest=facts.reduce((m,f)=>f.filed>m?f.filed:m,'');
 const ageDays=latest?Math.round((Date.parse(retrievedDay)-Date.parse(latest))/86400_000):null;
 const revenueTag=byTag.Revenues||byTag.RevenueFromContractWithCustomerExcludingAssessedTax;
 const missing=['NetIncomeLoss','Assets','StockholdersEquity'].filter(t=>!byTag[t]).concat(revenueTag?[]:['Revenue (either tag)']);
 return {facts:facts.length,dropped,byTag,periodsWithMultipleFilings:restated,latestFiled:latest||null,latestFiledAgeDays:ageDays,missingCoreTags:missing,
  stale:ageDays===null||ageDays>200};
}

export const datasetVersion=(items:{id:string;checksum:string}[])=>checksum([...items].sort((a,b)=>a.id.localeCompare(b.id)).map(i=>[i.id,i.checksum]));

/** Compare with the previous manifest: unchanged items are duplicates and are not stored again. */
export function diffManifest(prev:{id:string;checksum:string}[]|null,next:{id:string;checksum:string}[]){
 const p=new Map((prev??[]).map(i=>[i.id,i.checksum]));
 const added=next.filter(i=>!p.has(i.id)).map(i=>i.id),changed=next.filter(i=>p.has(i.id)&&p.get(i.id)!==i.checksum).map(i=>i.id),
  unchanged=next.filter(i=>p.get(i.id)===i.checksum).map(i=>i.id);
 return {added,changed,unchanged,duplicateDataset:!!prev&&added.length===0&&changed.length===0&&prev.length===next.length};
}
