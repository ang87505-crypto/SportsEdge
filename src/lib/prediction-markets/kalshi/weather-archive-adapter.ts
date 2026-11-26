/**
 * Read-only adapters from the raw archives that PR #226 retrieves (it owns retrieval; this never fetches) to the
 * multisource challenger's inputs. Everything is parsed from bytes the caller supplies:
 * - IEM MOS CSV (GFS MOS "n_x"; NBM NBS "txn" with "xnd"): the max reported at 00Z of D+1 is day D's maximum,
 *   per the MDL definitions (GFS MOS daytime max 7 AM-7 PM LST; NBM TXN max 12Z-06Z);
 * - archived CLINYC products: the existing parseCentralParkCli rules, keeping the FIRST complete next-morning
 *   report per climate day, available at its printed issuance time (cross-checked against the WMO header).
 * Outcomes carry provenance IEM_AFOS_CLI_ARCHIVE and are never mixed into the live v0/v1 training.
 */
import {createHash} from 'node:crypto';
import {parseCentralParkCli} from './nws-cli.ts';
import {MULTISOURCE_POLICY,type DailyOutcome,type MemberForecast} from './weather-multisource.ts';

const DAY=86_400_000;
export type MosModel='GFS'|'NBS';
export type AdapterIssues=Record<string,number>;
const bump=(i:AdapterIssues,k:string)=>{i[k]=(i[k]??0)+1;};

function splitCsvLine(line:string):string[]{
 const out:string[]=[];let cur='',q=false;
 for(let i=0;i<line.length;i++){const c=line[i];
  if(q){if(c==='"'&&line[i+1]==='"'){cur+='"';i++;}else if(c==='"')q=false;else cur+=c;}
  else if(c==='"')q=true;else if(c===','){out.push(cur);cur='';}else cur+=c;}
 out.push(cur);return out;
}
/** "2025-09-01 00:00", "2025-09-01 00:00:00+00", "2025-09-01T00:00Z" ... -> ISO, UTC. */
export function utcIso(s:string):string|null{
 const m=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]00(?::?00)?|UTC)?$/.exec(s.trim());
 if(!m)return null;const t=Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]??'00'}Z`);
 return Number.isFinite(t)?new Date(t).toISOString():null;
}
export function parseIemMosCsv(text:string,model:MosModel,station:string,P=MULTISOURCE_POLICY){
 if(typeof text!=='string'||text.length>64*1024*1024)throw Error('WX_ADAPTER_INVALID_CSV');
 const lines=text.replace(/^﻿/,'').split(/\r?\n/).filter(l=>l.trim());
 if(!lines.length)throw Error('WX_ADAPTER_INVALID_CSV');
 const header=splitCsvLine(lines[0]).map(h=>h.trim().toLowerCase()),col=(n:string)=>header.indexOf(n);
 const iSt=col('station'),iRun=col('runtime'),iF=col('ftime'),iMax=model==='GFS'?col('n_x'):col('txn'),iSd=model==='NBS'?col('xnd'):-1;
 if(iSt<0||iRun<0||iF<0||iMax<0)throw Error('WX_ADAPTER_MISSING_COLUMNS:'+header.join('|'));
 const member=model==='GFS'?'GFS_MOS' as const:'NBM' as const,latency=P.latencyHours[member]*3600_000;
 const out:MemberForecast[]=[],issues:AdapterIssues={},groups=new Map<string,MemberForecast[]>();
 const conflicts:{cycle:string;targetLocalDate:string;values:{valueF:number;sdF:number|null}[]}[]=[];
 for(const line of lines.slice(1)){
  const f=splitCsvLine(line);
  if(f.length!==header.length){bump(issues,'MALFORMED_ROW');continue;}
  if(f[iSt].trim().toUpperCase()!==station){bump(issues,'OTHER_STATION');continue;}
  const run=utcIso(f[iRun]),ft=utcIso(f[iF]);
  if(!run||!ft){bump(issues,'BAD_TIME');continue;}
  if(!ft.endsWith('T00:00:00.000Z'))continue;           // only the 00Z value is the daytime maximum
  const v=f[iMax].trim();if(v===''||v==='M'||v==='None'){bump(issues,'MISSING_MAX');continue;}
  const valueF=Number(v);if(!Number.isFinite(valueF)||valueF< -100||valueF>150){bump(issues,'BAD_MAX');continue;}
  let sdF:number|null=null;
  if(iSd>=0){const s=f[iSd].trim();if(s!==''&&s!=='M'&&s!=='None'){const x=Number(s);if(Number.isFinite(x)&&x>=0&&x<=40)sdF=x;}}
  const targetLocalDate=new Date(Date.parse(ft)-DAY).toISOString().slice(0,10);
  if(Date.parse(ft)<=Date.parse(run)){bump(issues,'FORECAST_NOT_AHEAD');continue;}
  const key=run+'|'+targetLocalDate,row={member,station,targetLocalDate,cycle:run,availableAt:new Date(Date.parse(run)+latency).toISOString(),valueF,sdF};
  groups.set(key,[...(groups.get(key)??[]),row]);
 }
 // Duplicate archive rows for the same cycle and valid time carry no revision clock, so which one is "right" is unknowable.
 // Identical used values (max, and XND for NBM) collapse to one row. If they disagree, every copy is excluded and listed.
 for(const rows of groups.values()){
  if(rows.length===1){out.push(rows[0]);continue;}
  const distinct=[...new Map(rows.map(r=>[r.valueF+'|'+r.sdF,{valueF:r.valueF,sdF:r.sdF}])).values()];
  if(distinct.length===1){bump(issues,'DUPLICATE_IDENTICAL');out.push(rows[0]);continue;}
  bump(issues,'CONFLICTING_DUPLICATE_EXCLUDED');
  conflicts.push({cycle:rows[0].cycle,targetLocalDate:rows[0].targetLocalDate,values:distinct});
 }
 out.sort((a,b)=>a.cycle.localeCompare(b.cycle)||a.targetLocalDate.localeCompare(b.targetLocalDate));
 return {forecasts:out,issues,conflicts};
}
const STATION_FROM_ICAO:Record<string,string>={KNYC:'KNYC_CENTRAL_PARK'};
export const stationKey=(icao:string)=>STATION_FROM_ICAO[icao]??icao;

/** Archived CLINYC texts -> the first complete next-morning report per climate day. */
export function parseCliArchive(products:readonly {name:string;text:string}[]){
 const issues:AdapterIssues={},best=new Map<string,DailyOutcome&{sourceDigest:string;name:string}>(),conflicted=new Set<string>();
 for(const p of products){
  const raw=String(p.text).replace(/\r\n/g,'\n');
  const issued=/^\s*(\d{3,4})\s+(AM|PM)\s+(EST|EDT)\s+\w{3}\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})\s+(\d{4})\s*$/m.exec(raw);
  if(!issued){bump(issues,'NO_ISSUANCE_LINE');continue;}
  const mon=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(issued[4]);
  const clock=issued[1].padStart(4,'0'),hh=Number(clock.slice(0,2)),mm=Number(clock.slice(2));
  if(hh<1||hh>12||mm>59){bump(issues,'BAD_ISSUANCE');continue;}
  const utcH=(hh%12)+(issued[2]==='PM'?12:0)+(issued[3]==='EST'?5:4);
  const issuedAt=new Date(Date.UTC(Number(issued[6]),mon,Number(issued[5]),utcH,mm)).toISOString();
  // The WMO header DDHHMM must agree with the printed issuance within 90 minutes, or the product is refused.
  const wmo=/\bCDUS41 KOKX (\d{2})(\d{2})(\d{2})\b/.exec(raw);
  if(!wmo){bump(issues,'NO_WMO_HEADER');continue;}
  const it=new Date(issuedAt),cand=[-1,0,1].map(k=>Date.UTC(it.getUTCFullYear(),it.getUTCMonth()+k,Number(wmo[1]),Number(wmo[2]),Number(wmo[3])));
  if(!cand.some(t=>Math.abs(t-Date.parse(issuedAt))<=90*60_000)){bump(issues,'WMO_ISSUANCE_MISMATCH');continue;}
  let c;
  try{c=parseCentralParkCli(raw,issuedAt);}
  catch(e){bump(issues,e instanceof Error?e.message:'PARSE_ERROR');continue;}
  const o={station:'KNYC_CENTRAL_PARK',localDate:c.reportDate,observedHighF:c.observedHighF,observedAvailableAt:c.issuedAt,
   provenance:'IEM_AFOS_CLI_ARCHIVE' as const,sourceDigest:c.sourceDigest,name:p.name};
  const prev=best.get(o.localDate);
  if(prev){
   bump(issues,'LATER_OR_DUPLICATE_REPORT');
   if(prev.observedHighF!==o.observedHighF){
    bump(issues,'REPORT_REVISED_VALUE');
    // Two different highs issued at the same minute: which is first is unknowable, so the day is excluded.
    if(Date.parse(o.observedAvailableAt)===Date.parse(prev.observedAvailableAt)){conflicted.add(o.localDate);continue;}
   }
   if(Date.parse(o.observedAvailableAt)>=Date.parse(prev.observedAvailableAt))continue;
  }
  best.set(o.localDate,o);
 }
 for(const d of conflicted){best.delete(d);bump(issues,'CONFLICTING_SAME_TIME_REPORT_EXCLUDED');}
 const outcomes=[...best.values()].sort((a,b)=>a.localDate.localeCompare(b.localDate));
 return {outcomes:outcomes.map(o=>({station:o.station,localDate:o.localDate,observedHighF:o.observedHighF,observedAvailableAt:o.observedAvailableAt,provenance:o.provenance})) as DailyOutcome[],sources:outcomes.map(o=>({date:o.localDate,name:o.name,sourceDigest:o.sourceDigest})),issues};
}

/**
 * Receipt-checked loader for one retrieval run's files (PR #226's artifact layout). Every file is hashed and must
 * match the receipt before it is parsed; a receipt that is not RETRIEVED_UNVALIDATED, or that made exchange
 * requests, is refused.
 */
export function loadVerifiedArchive(x:{receiptText:string;files:{name:string;bytes:Uint8Array}[];cliProducts:{name:string;text:string}[];icao?:string}){
 const receipt=JSON.parse(x.receiptText) as {status?:string;exchange_requests?:number;retrieved_at?:string;target_start?:string;target_end?:string;
  files?:{name:string;sha256?:string;captured_at?:string}[]};
 if(receipt.status!=='RETRIEVED_UNVALIDATED'||receipt.exchange_requests!==0)throw Error('WX_ARCHIVE_RECEIPT_NOT_USABLE');
 const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),inputsSha256:Record<string,string>={};
 for(const f of x.files){const r=(receipt.files??[]).find(z=>z.name===f.name),h=sha(f.bytes);
  if(!r||r.sha256!==h)throw Error('INPUT_HASH_MISMATCH '+f.name);inputsSha256[f.name]=h;}
 const icao=x.icao??'KNYC',station=stationKey(icao),text=(p:string)=>new TextDecoder().decode(x.files.find(f=>f.name.startsWith(p))?.bytes);
 const gfsFile=x.files.find(f=>f.name.startsWith('gfs-')),nbsFile=x.files.find(f=>f.name.startsWith('nbs-'));
 if(!gfsFile||!nbsFile)throw Error('WX_ARCHIVE_MISSING_MOS');
 const g=parseIemMosCsv(text('gfs-'),'GFS',icao),n=parseIemMosCsv(text('nbs-'),'NBS',icao),cli=parseCliArchive(x.cliProducts);
 const DATE=/^\d{4}-\d{2}-\d{2}$/,capturedAt=(receipt.files??[]).map(f=>f.captured_at).filter((t):t is string=>!!t&&Number.isFinite(Date.parse(t)));
 return {station,retrievedAt:receipt.retrieved_at??null,
  /** Latest per-file capture time: every row used was held by then (actual retrieval, not a modeled runtime). */
  capturedAt:capturedAt.length===(receipt.files??[]).length&&capturedAt.length?capturedAt.sort().at(-1)!:null,
  targetStart:DATE.test(receipt.target_start??'')?receipt.target_start!:null,targetEnd:DATE.test(receipt.target_end??'')?receipt.target_end!:null,inputsSha256,
  inputsDigest:createHash('sha256').update(JSON.stringify(Object.entries(inputsSha256).sort())).digest('hex'),
  forecasts:[...g.forecasts,...n.forecasts].map(f=>({...f,station})),outcomes:cli.outcomes,outcomeSources:cli.sources,
  issues:{gfs:g.issues,nbs:n.issues,cli:cli.issues},conflicts:{gfs:g.conflicts,nbs:n.conflicts}};
}
