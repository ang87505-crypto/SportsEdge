/**
 * AI 2.0 research intake collector (research only; runs in GitHub Actions, never in production).
 *   node --experimental-strip-types scripts/research-intake-collect.ts --out <dir> [--tickers AAPL,MSFT] [--literature] [--previous manifest.json]
 * GET-only, host-allowlisted (sec.gov, data.sec.gov, api.openalex.org, export.arxiv.org), declared SEC User-Agent from the
 * SEC_EDGAR_USER_AGENT secret, per-host minimum intervals (SEC <= 10/s, OpenAlex <= 10/s, arXiv 1 per 3 s), bounded
 * retries (429/5xx only), a hard request budget, checksums and dataset versioning, point-in-time validation and a
 * quality report. The scheduled source-memory workflow archives these outputs separately. Literature is hypothesis-only.
 * Nothing here writes to a database, places an order or touches a model.
 */
import {writeFileSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {parseCompanyFacts,provenanceFor} from '../src/lib/research/sec-companyfacts.ts';
import {parseTickerMap,validatePointInTime,qualityReport,datasetVersion,diffManifest} from '../src/lib/research/collect.ts';
import {secIntakeV2} from '../src/lib/research/sec-intake-v2.ts';
import {planRequests,parseOpenAlex,parseArxiv,retryDelayMs,memoryKeys} from '../src/lib/research/discovery.ts';
import {checksum,record,verify} from '../src/lib/research/provenance.ts';
import {sourceById} from '../src/lib/research/sources.ts';
import {assessResearchLead,INTAKE_QUALITY_POLICY,type LeadQuality} from '../src/lib/research/quality.ts';

const argv=process.argv,opt=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?null:argv[i+1];};
const out=opt('out');if(!out)throw new Error('missing --out');
mkdirSync(out+'/sec-companyfacts',{recursive:true});
const now=new Date().toISOString(),today=now.slice(0,10);
const ALLOWED=new Set(['www.sec.gov','data.sec.gov','api.openalex.org','export.arxiv.org']);
const INTERVAL:Record<string,number>={'www.sec.gov':150,'data.sec.gov':150,'api.openalex.org':200,'export.arxiv.org':3100};
const BUDGET=Number(process.env.INTAKE_MAX_REQUESTS??80);
if(!Number.isSafeInteger(BUDGET)||BUDGET<1||BUDGET>80)throw Error('INVALID_INTAKE_BUDGET');
let requests=0;const last:Record<string,number>={};const log:{url:string;status:number|string;attempt:number;ms:number}[]=[];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function get(url:string,headers:Record<string,string>,as:'json'|'text'){
 const host=new URL(url).hostname;if(!ALLOWED.has(host))throw new Error('HOST_NOT_ALLOWED '+host);
 for(let attempt=0;;attempt++){
  if(requests>=BUDGET)throw new Error('BUDGET_EXHAUSTED');requests++;
  const wait=(last[host]??0)+INTERVAL[host]-Date.now();if(wait>0)await sleep(wait);last[host]=Date.now();
  const t=Date.now();let status:number|null=null,retryAfterMs=0;
  try{
   const r=await fetch(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(30_000)});status=r.status;
   const retryAfter=r.headers.get('retry-after');
   if(retryAfter)retryAfterMs=/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Math.max(0,Date.parse(retryAfter)-Date.now());
   log.push({url,status,attempt,ms:Date.now()-t});
   if(r.ok){
    if(Number(r.headers.get('content-length')??0)>10_000_000)throw Error('INTAKE_RESPONSE_TOO_LARGE');
    const body=await r.text();if(Buffer.byteLength(body)>10_000_000)throw Error('INTAKE_RESPONSE_TOO_LARGE');
    return as==='json'?JSON.parse(body):body;
   }
  }catch(e){log.push({url,status:e instanceof Error?e.name:'error',attempt,ms:Date.now()-t});}
  const d=retryDelayMs(attempt,status,3,retryAfterMs);if(d===null)throw new Error(`HTTP_${status??'NETWORK'} ${url}`);await sleep(d);
 }
}

const status:Record<string,{attempted:number;succeeded:number;failures:string[]}>={};
const mark=(s:string)=>status[s]??=({attempted:0,succeeded:0,failures:[]});
const manifest:{id:string;checksum:string}[]=[];const secReport:Record<string,unknown>[]=[];

const tickers=(opt('tickers')??'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean).slice(0,40);
if(tickers.length){
 const ua=process.env.SEC_EDGAR_USER_AGENT??'';
 const st=mark('sec-edgar-companyfacts');
 if(!/\S+@\S+/.test(ua)&&!/\(.+\)/.test(ua)){st.failures.push('SEC_EDGAR_USER_AGENT missing or without contact');}
 else{
  const h={'User-Agent':ua,Accept:'application/json'};
  let map=new Map<string,string>();
  try{map=parseTickerMap(await get('https://www.sec.gov/files/company_tickers.json',h,'json'));}catch(e){st.failures.push('ticker map: '+(e as Error).message);}
  for(const t of tickers){
   const cik=map.get(t);if(!cik){if(map.size)st.failures.push(t+': no CIK');continue;}
   st.attempted++;
   try{
    const body=await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,h,'json');
    const {facts,dropped}=parseCompanyFacts(body);
    const prov=provenanceFor(body,cik,now);
    const v=verify(prov,now);
    const pit=validatePointInTime(facts,today,['2020-01-02','2022-06-30','2024-03-15','2025-11-14',today]);
    const quality=qualityReport(facts,dropped,today);
    const v2=secIntakeV2(body,cik,today,['2020-01-02','2022-06-30','2024-03-15','2025-11-14',today]);
    const factsChecksum=checksum(facts);
    manifest.push({id:'CIK'+cik,checksum:prov.checksumSha256});
    writeFileSync(`${out}/sec-companyfacts/CIK${cik}.json`,JSON.stringify({ticker:t,cik,source:'sec-edgar-companyfacts',retrievedAt:now,
     rawChecksumSha256:prov.checksumSha256,factsChecksumSha256:factsChecksum,availableAt:prov.availableAt,facts,v2:v2.archive})+'\n');
    secReport.push({ticker:t,cik,rawChecksum:prov.checksumSha256.slice(0,16),provenance:v,pointInTime:pit,quality,v2:v2.diagnostics});
    if(facts.length&&pit.ok&&v.usable&&!quality.stale)st.succeeded++;else st.failures.push(t+': '+(facts.length?'validation failed or stale filing metadata':'no facts'));
   }catch(e){st.failures.push(t+': '+(e as Error).message);}
  }
 }
}

const literature:Record<string,unknown>={};
if(argv.includes('--literature')){
 const queries=['player prop betting market efficiency','sports betting probability calibration','basketball player minutes projection',
  'time series momentum low volatility anomaly','post earnings announcement drift'];
 const leads:ReturnType<typeof parseOpenAlex>=[];
 const quality=new Map<string,LeadQuality>();
 for(const src of ['openalex','arxiv'] as const){
  const st=mark(src);
  const sourceQueries=src==='arxiv'?queries.slice(0,3):queries;
  for(const [i,{url}] of planRequests(src,sourceQueries,{fromYear:new Date(now).getUTCFullYear()-1,perPage:10}).entries()){
   st.attempted++;
   try{
    const body=await get(url,{Accept:src==='openalex'?'application/json':'application/atom+xml','User-Agent':'sportsedge-research-intake'},src==='openalex'?'json':'text');
    const got=src==='openalex'?parseOpenAlex(body,now):parseArxiv(body as string,now);
    for(const l of got){const assessed=assessResearchLead(l,sourceQueries[i],now),old=quality.get(l.source+':'+l.id);
     if(!old||assessed.matchedTerms.length>old.matchedTerms.length)quality.set(l.source+':'+l.id,assessed);}
    leads.push(...got);st.succeeded++;
   }catch(e){st.failures.push((e as Error).message.slice(0,160));}
  }
 }
 const seen=new Set<string>();const deduped=leads.filter(l=>{const k=memoryKeys(l);if(k.some(x=>seen.has(x)))return false;k.forEach(x=>seen.add(x));return true;});
 const unique=deduped.slice(0,INTAKE_QUALITY_POLICY.maxLeadsPerRun);
 const records=unique.map(l=>({...record({sourceId:l.source,sourceItemId:l.id,originalUrl:l.url,retrievedAt:now,availableAt:l.publishedAt?l.publishedAt+'T00:00:00Z':null,
  eventDate:null,reliability:sourceById(l.source)!.reliability,intendedUse:'hypothesis-only',content:{title:l.title,abstract:l.abstract.slice(0,600),doi:l.doi,
   kind:l.kind,publishedAt:l.publishedAt,updatedAt:l.updatedAt??null,retracted:l.retracted??null,pulled:l.pulled??null,contentHash:l.contentHash}}),quality:quality.get(l.source+':'+l.id)!}));
 for(const r of records)manifest.push({id:r.sourceId+':'+r.sourceItemId,checksum:checksum({content:r.checksumSha256,status:r.quality.status,reasons:r.quality.reasons,policy:INTAKE_QUALITY_POLICY.version})});
 writeFileSync(out+'/literature-leads.json',JSON.stringify(records,null,1)+'\n');
 literature.leads=records.length;literature.duplicatesRemoved=leads.length-deduped.length;literature.overCapExcluded=deduped.length-unique.length;literature.suspectedInjection=unique.filter(l=>l.suspectedInjection).length;
 literature.reviewQueue=records.filter(r=>r.quality.status==='REVIEW_QUEUE').length;
 literature.quarantined=records.filter(r=>r.quality.status==='QUARANTINED').length;literature.policy=INTAKE_QUALITY_POLICY;
 literature.allHypothesisOnly=records.every(r=>verify(r,now).reasons.includes('LITERATURE_NEVER_A_FEATURE'));
}

const prev=opt('previous')&&existsSync(opt('previous')!)?JSON.parse(readFileSync(opt('previous')!,'utf8')).items:null;
const version=datasetVersion(manifest),diff=diffManifest(prev,manifest);
const report={generatedBy:'scripts/research-intake-collect.ts',retrievedAt:now,datasetVersion:version,diff,requests,budget:BUDGET,
 sources:Object.fromEntries(Object.entries(status).map(([k,v])=>[k,{...v,connected:v.succeeded>0&&v.failures.length===0?'VERIFIED_THIS_RUN':v.succeeded>0?'PARTIAL':'FAILED'}])),
 survivorship:'The ticker list is a CURRENT list chosen for verification; it is not survivorship-free and must not be treated as a research universe.',
 sec:secReport,literature,requestLog:log.map(l=>({...l,url:l.url.replace(/search(_query)?=[^&]*/,'search=…')}))};
writeFileSync(out+'/manifest.json',JSON.stringify({datasetVersion:version,retrievedAt:now,items:manifest},null,1)+'\n');
writeFileSync(out+'/report.json',JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify({datasetVersion:version.slice(0,16),requests,sources:report.sources,diff:{added:diff.added.length,changed:diff.changed.length,unchanged:diff.unchanged.length,duplicate:diff.duplicateDataset},literature}));
if(Object.values(status).some(s=>s.succeeded===0))process.exitCode=1;
