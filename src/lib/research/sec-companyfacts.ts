/**
 * AI 2.0 research intake: SEC EDGAR XBRL company facts → point-in-time fundamentals. Pure parser; no I/O.
 * The SEC publishes every reported value with the date its filing was accepted ('filed'). A fundamental is usable
 * for a decision only from that date: this is what makes quality/value research point-in-time instead of
 * look-ahead. Restated values are kept as separate records with their own filed date (never overwrite history).
 * Fetching (data.sec.gov, declared User-Agent, <= 10 requests/s) is NOT implemented here and needs owner approval.
 */
import {record,type ProvenanceRecord} from './provenance.ts';

export type PitFact={cik:string;tag:string;unit:string;periodEnd:string;value:number;form:string;fiscalPeriod:string|null;
 accession:string;filed:string};

const TAGS=['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','NetIncomeLoss','Assets','Liabilities',
 'StockholdersEquity','OperatingIncomeLoss','NetCashProvidedByUsedInOperatingActivities'] as const;
const FORMS=new Set(['10-K','10-Q','10-K/A','10-Q/A']);
const DAY=/^\d{4}-\d{2}-\d{2}$/;

/** Parse a companyfacts JSON body. Malformed entries are dropped and counted, never repaired. */
export function parseCompanyFacts(body:unknown):{facts:PitFact[];dropped:number}{
 const b=body as {cik?:unknown;facts?:{'us-gaap'?:Record<string,{units?:Record<string,unknown[]>}>}};
 const cik=typeof b?.cik==='number'||typeof b?.cik==='string'?String(b.cik).padStart(10,'0'):null;
 const gaap=b?.facts?.['us-gaap'];
 if(!cik||!/^\d{10}$/.test(cik)||!gaap||typeof gaap!=='object')return {facts:[],dropped:0};
 const facts:PitFact[]=[];let dropped=0;
 for(const tag of TAGS){
  const units=gaap[tag]?.units;if(!units)continue;
  for(const [unit,rows] of Object.entries(units)){
   if(!Array.isArray(rows))continue;
   for(const raw of rows){
    const x=raw as {end?:unknown;val?:unknown;form?:unknown;fp?:unknown;accn?:unknown;filed?:unknown};
    if(typeof x.end!=='string'||!DAY.test(x.end)||typeof x.filed!=='string'||!DAY.test(x.filed)||typeof x.val!=='number'||!Number.isFinite(x.val)
     ||typeof x.form!=='string'||!FORMS.has(x.form)||typeof x.accn!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(x.accn)||x.filed<x.end){dropped++;continue;}
    facts.push({cik,tag,unit,periodEnd:x.end,value:x.val,form:x.form,fiscalPeriod:typeof x.fp==='string'?x.fp:null,accession:x.accn,filed:x.filed});
   }
  }
 }
 facts.sort((a,b)=>a.tag.localeCompare(b.tag)||a.periodEnd.localeCompare(b.periodEnd)||a.filed.localeCompare(b.filed)||a.accession.localeCompare(b.accession));
 return {facts,dropped};
}

/** The latest value of `tag` that was PUBLIC strictly before `asOf` (YYYY-MM-DD): filed < asOf, newest period, newest filing. */
export function asOf(facts:PitFact[],tag:string,asOfDay:string):PitFact|null{
 let best:PitFact|null=null;
 for(const f of facts){
  if(f.tag!==tag||!(f.filed<asOfDay))continue;
  if(!best||f.periodEnd>best.periodEnd||(f.periodEnd===best.periodEnd&&f.filed>best.filed))best=f;
 }
 return best;
}

/** Provenance record for one fetched companyfacts body (availability = the newest filing date it contains). */
export function provenanceFor(body:unknown,cik:string,retrievedAt:string):ProvenanceRecord{
 const {facts}=parseCompanyFacts(body);
 const newest=facts.reduce((m,f)=>f.filed>m?f.filed:m,'');
 return record({sourceId:'sec-edgar-companyfacts',sourceItemId:'CIK'+cik,originalUrl:`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
  retrievedAt,availableAt:newest?newest+'T00:00:00Z':null,eventDate:null,reliability:'regulatory',intendedUse:'point-in-time-feature',content:body});
}
