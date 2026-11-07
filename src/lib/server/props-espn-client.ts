/**
 * ESPN public NBA JSON (no key) for box scores used to grade props and to build
 * current-season player logs. Undocumented endpoint with no published licence;
 * production already depends on it for moneyline settlement. Reads only,
 * bounded retries (free), short timeouts.
 */
export type EspnReply={ok:boolean;httpStatus:number;body:unknown;receivedAt:string};
export interface EspnClient{scoreboard(yyyymmdd:string):Promise<EspnReply>;summary(eventId:string):Promise<EspnReply>;}
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';

export function espnClient(fetcher:typeof fetch=fetch,clock:()=>string=()=>new Date().toISOString(),
 sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):EspnClient{
 async function get(path:string):Promise<EspnReply>{
  let last:EspnReply={ok:false,httpStatus:599,body:null,receivedAt:clock()};
  for(let attempt=0;attempt<3;attempt++){
   if(attempt)await sleep(1000*2**attempt);
   try{
    const r=await fetcher(BASE+path,{cache:'no-store',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(12_000)});
    const text=await r.text();
    if(text.length>5_000_000)return {ok:false,httpStatus:r.status,body:null,receivedAt:clock()};
    let body:unknown=null;try{body=JSON.parse(text);}catch{/* non-JSON */}
    last={ok:r.ok&&body!==null,httpStatus:r.status,body,receivedAt:clock()};
    if(last.ok||(r.status>=400&&r.status<500&&r.status!==429))return last;
   }catch{last={ok:false,httpStatus:599,body:null,receivedAt:clock()};}
  }
  return last;
 }
 return {
  scoreboard:d=>{if(!/^\d{8}$/.test(d))throw new Error('INVALID_DATE');return get('scoreboard?dates='+d+'&limit=100');},
  summary:id=>{if(!/^\d{6,12}$/.test(id))throw new Error('INVALID_EVENT');return get('summary?event='+id);},
 };
}

/** Keep only the fields the parser uses (header + box score) so stored evidence stays bounded. */
export function trimSummary(body:unknown):unknown{
 const o=body&&typeof body==='object'?body as Record<string,unknown>:{};
 const box=o.boxscore&&typeof o.boxscore==='object'?(o.boxscore as Record<string,unknown>):{};
 const players=Array.isArray(box.players)?box.players.map(t=>{
  const team=(t as Record<string,unknown>)?.team as Record<string,unknown>|undefined;
  const stats=Array.isArray((t as Record<string,unknown>)?.statistics)?((t as Record<string,unknown>).statistics as unknown[]).slice(0,1).map(s=>{
   const st=s as Record<string,unknown>;
   return {keys:st.keys,athletes:Array.isArray(st.athletes)?st.athletes.map(a=>{const x=a as Record<string,unknown>;
    const ath=x.athlete as Record<string,unknown>|undefined;
    return {athlete:{id:ath?.id,displayName:ath?.displayName},didNotPlay:x.didNotPlay,reason:x.reason,stats:x.stats};}):[]};
  }):[];
  return {team:{abbreviation:team?.abbreviation,displayName:team?.displayName},statistics:stats};
 }):[];
 const header=o.header as Record<string,unknown>|undefined;
 const comps=Array.isArray(header?.competitions)?(header!.competitions as unknown[]).slice(0,1).map(c=>{
  const x=c as Record<string,unknown>;
  return {id:x.id,date:x.date,status:x.status,competitors:Array.isArray(x.competitors)?x.competitors.map(k=>{
   const y=k as Record<string,unknown>;const team=y.team as Record<string,unknown>|undefined;
   return {homeAway:y.homeAway,score:y.score,team:{abbreviation:team?.abbreviation,displayName:team?.displayName}};}):[]};
 }):[];
 return {header:{id:header?.id,competitions:comps},boxscore:{players}};
}
