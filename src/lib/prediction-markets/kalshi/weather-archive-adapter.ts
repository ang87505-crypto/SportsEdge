/**
 * Read-only adapters from the raw archives that PR #226 retrieves (it owns retrieval; this never fetches) to the
 * multisource challenger's inputs. Everything is parsed from bytes the caller supplies:
 * - IEM MOS CSV (GFS MOS "n_x"; NBM NBS "txn" with "xnd"): the max reported at 00Z of D+1 is day D's maximum,
 *   per the MDL definitions (GFS MOS daytime max 7 AM-7 PM LST; NBM TXN max 12Z-06Z);
 * - archived CLINYC products: the existing parseCentralParkCli rules, keeping the FIRST complete next-morning
 *   report per climate day, available at its printed issuance time (cross-checked against the WMO header).
 * Outcomes carry provenance IEM_AFOS_CLI_ARCHIVE and are never mixed into the live v0/v1 training.
 */
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
 const out:MemberForecast[]=[],issues:AdapterIssues={},seen=new Set<string>();
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
  const key=run+'|'+targetLocalDate;if(seen.has(key)){bump(issues,'DUPLICATE_ROW');continue;}seen.add(key);
  out.push({member,station,targetLocalDate,cycle:run,availableAt:new Date(Date.parse(run)+latency).toISOString(),valueF,sdF});
 }
 return {forecasts:out,issues};
}
const STATION_FROM_ICAO:Record<string,string>={KNYC:'KNYC_CENTRAL_PARK'};
export const stationKey=(icao:string)=>STATION_FROM_ICAO[icao]??icao;

/** Archived CLINYC texts -> the first complete next-morning report per climate day. */
export function parseCliArchive(products:readonly {name:string;text:string}[]){
 const issues:AdapterIssues={},best=new Map<string,DailyOutcome&{sourceDigest:string;name:string}>();
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
  if(prev){bump(issues,'LATER_OR_DUPLICATE_REPORT');if(prev.observedHighF!==o.observedHighF)bump(issues,'REPORT_REVISED_VALUE');
   if(Date.parse(o.observedAvailableAt)>=Date.parse(prev.observedAvailableAt))continue;}
  best.set(o.localDate,o);
 }
 const outcomes=[...best.values()].sort((a,b)=>a.localDate.localeCompare(b.localDate));
 return {outcomes:outcomes.map(o=>({station:o.station,localDate:o.localDate,observedHighF:o.observedHighF,observedAvailableAt:o.observedAvailableAt,provenance:o.provenance})) as DailyOutcome[],sources:outcomes.map(o=>({date:o.localDate,name:o.name,sourceDigest:o.sourceDigest})),issues};
}
