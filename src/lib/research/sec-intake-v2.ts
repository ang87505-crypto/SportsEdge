/** Duration-aware diagnostics over the already fetched SEC body. No new endpoint or network request. */
import {parseCompanyFactsV2,asOfKind,durationAmbiguity,restatementReport,identityCheck,type PeriodKind} from './sec-pit-v2.ts';
import {checksum} from './provenance.ts';

// Same research tags as the existing v1 intake. Preserve source rows (including start) for reproducible v2 parsing.
export const SEC_INTAKE_TAGS=['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','NetIncomeLoss','Assets','Liabilities',
 'StockholdersEquity','OperatingIncomeLoss','NetCashProvidedByUsedInOperatingActivities'] as const;
const FLOWS=['Revenues','RevenueFromContractWithCustomerExcludingAssessedTax','NetIncomeLoss','OperatingIncomeLoss','NetCashProvidedByUsedInOperatingActivities'];

export function secIntakeV2(body:unknown,expectedCik:string,retrievedDay:string,cutoffs:string[],windowStart='2017-01-01'){
 const b=body as {cik?:unknown;entityName?:unknown;facts?:{'us-gaap'?:Record<string,unknown>}};
 const sourcePayload={cik:b?.cik??null,entityName:b?.entityName??null,
  facts:{'us-gaap':Object.fromEntries(SEC_INTAKE_TAGS.filter(t=>b?.facts?.['us-gaap']?.[t]).map(t=>[t,b.facts!['us-gaap']![t]]))}};
 const {facts,dropped}=parseCompanyFactsV2(sourcePayload,SEC_INTAKE_TAGS);
 const identity=identityCheck(facts,windowStart);
 if(String(b?.cik??'').padStart(10,'0')!==expectedCik)identity.flags.push('MAPPED_CIK_MISMATCH');
 identity.usable=identity.flags.length===0;
 let checked=0,leaks=0;
 for(const day of cutoffs)for(const tag of SEC_INTAKE_TAGS)for(const kind of ['instant','quarter','annual','other'] as PeriodKind[]){
  checked++;const f=asOfKind(facts,tag,kind,day);if(f&&!(f.filed<day))leaks++;
 }
 const filedAfterRetrieval=facts.filter(f=>f.filed>retrievedDay).length;
 return {archive:{schema:'sec-pit-v2' as const,sourcePayload,sourcePayloadSha256:checksum(sourcePayload),facts,
   factsChecksumSha256:checksum(facts)},
  diagnostics:{schema:'sec-pit-v2' as const,facts:facts.length,dropped,windowStart,
   pointInTime:{ok:!leaks&&!filedAfterRetrieval,asOfLeaks:leaks,filedAfterRetrieval,cutoffsChecked:checked},
   durationAmbiguity:durationAmbiguity(facts,FLOWS,cutoffs),restatements:restatementReport(facts),identity}};
}
