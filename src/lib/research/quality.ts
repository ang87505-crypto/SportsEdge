/** Research metadata is a lead, never a trading signal or proof that a study's conclusion is correct. */
import type {Lead} from './discovery.ts';
export const INTAKE_QUALITY_POLICY={version:'research-quality-v1',maxRetrievalAgeHours:72,minMatchedTerms:2,
 maxLeadsPerRun:80,reviewRequired:true} as const;
const words=(s:string)=>new Set(s.toLowerCase().match(/[a-z]{4,}/g)??[]);
export type LeadQuality={status:'REVIEW_QUEUE'|'QUARANTINED';reasons:string[];matchedTerms:string[];publicationAgeDays:number|null;peerReviewVerified:false};
export function assessResearchLead(l:Lead,query:string,nowIso:string):LeadQuality{
 const now=Date.parse(nowIso),retrieved=Date.parse(l.retrievedAt),published=l.publishedAt?Date.parse(l.publishedAt):NaN,reasons:string[]=[];
 if(!Number.isFinite(now))throw Error('RESEARCH_INVALID_CLOCK');
 if(!Number.isFinite(retrieved)||retrieved>now||now-retrieved>INTAKE_QUALITY_POLICY.maxRetrievalAgeHours*3600_000)reasons.push('STALE_OR_INVALID_RETRIEVAL');
 if(!l.publishedAt||!Number.isFinite(published)||new Date(published).toISOString().slice(0,10)!==l.publishedAt||published>now)reasons.push('UNKNOWN_OR_FUTURE_PUBLICATION');
 if(l.updatedAt&&(!Number.isFinite(Date.parse(l.updatedAt))||Date.parse(l.updatedAt)>now))reasons.push('INVALID_UPDATE_TIME');
 if(l.retracted||l.pulled||/^(retracted|withdrawn|removed)\b/i.test(l.title))reasons.push('RETRACTED_OR_WITHDRAWN');
 if(l.suspectedInjection)reasons.push('INSTRUCTION_LIKE_EXTERNAL_TEXT');
 const text=words(l.title+' '+l.abstract),matchedTerms=[...words(query)].filter(w=>text.has(w));
 if(matchedTerms.length<INTAKE_QUALITY_POLICY.minMatchedTerms)reasons.push('INSUFFICIENT_TOPIC_RELEVANCE');
 if(!l.title||!l.abstract)reasons.push('INSUFFICIENT_METHOD_METADATA');
 return {status:reasons.length?'QUARANTINED':'REVIEW_QUEUE',reasons,matchedTerms,publicationAgeDays:Number.isFinite(published)?Math.floor((now-published)/86400_000):null,peerReviewVerified:false};
}
