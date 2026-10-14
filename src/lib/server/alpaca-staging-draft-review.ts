/** Owner-only, read-only STAGING draft inventory. No Alpaca API or writes. */
import {StagingPaperError} from './alpaca-staging-operator.ts';
const ORIGIN='https://mcaxfaaohyencpspalfe.supabase.co';
const PATH='/rest/v1/rpc/sportsedge_paper_stage_drafts';
type Settings={url:string;key:string};
export type PaperStageDraft={
 intentId:string;symbol:string;shares:1;limitCents:number;
 status:'planned';createdAt:string;
};
export type PaperStageDraftInventory={
 environment:'SportsEdge Staging';accountKind:'paper';gateHalted:true;
 executionPermitted:false;brokerCalls:0;drafts:PaperStageDraft[];
};
function configuration(settings?:Settings):Settings{
 const c=settings??{url:process.env.SPORTSEDGE_STAGING_SUPABASE_URL??'',
  key:process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY??''};
 if(!c.url||!c.key)throw new StagingPaperError('NOT_CONFIGURED');
 let url:URL;
 try{url=new URL(c.url);}catch{throw new StagingPaperError('INVALID_CONFIG');}
 if(url.origin!==ORIGIN||(url.pathname!==''&&url.pathname!=='/')||
   url.search||url.hash||url.username||url.password||
   c.key.length<24||c.key.length>4000)throw new StagingPaperError('INVALID_CONFIG');
 return c;
}
export function validateDraftInventory(raw:unknown):PaperStageDraftInventory{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw new StagingPaperError('BAD_RESPONSE');
 const r=raw as Record<string,unknown>;
 if(r.environment!=='SportsEdge Staging'||r.accountKind!=='paper'||
   r.gateHalted!==true||r.executionPermitted!==false||
   r.brokerCalls!==0||!Array.isArray(r.drafts)||r.drafts.length>20)
  throw new StagingPaperError('BAD_RESPONSE');
 const seen=new Set<string>();
 const drafts:PaperStageDraft[]=r.drafts.map((value:unknown)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))
   throw new StagingPaperError('BAD_RESPONSE');
  const x=value as Record<string,unknown>;
  if(typeof x.intentId!=='string'||!/^preview-[a-f0-9]{32}$/.test(x.intentId)||
    seen.has(x.intentId)||typeof x.symbol!=='string'||!/^[A-Z]{1,5}$/.test(x.symbol)||
    x.status!=='planned'||x.shares!==1||
    !Number.isSafeInteger(x.limitCents)||(x.limitCents as number)<1||
    (x.limitCents as number)>2500||typeof x.createdAt!=='string'||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x.createdAt)||
    !Number.isFinite(Date.parse(x.createdAt)))
   throw new StagingPaperError('BAD_RESPONSE');
  seen.add(x.intentId);
  return {intentId:x.intentId,symbol:x.symbol,shares:1,
   limitCents:x.limitCents as number,status:'planned',createdAt:x.createdAt};
 });
 return {environment:'SportsEdge Staging',accountKind:'paper',gateHalted:true,
  executionPermitted:false,brokerCalls:0,drafts};
}
/** Supabase RPC uses POST for a READ-ONLY SQL function, never a broker POST. */
export async function listUnapprovedStagingDrafts(
 fetcher:typeof fetch=fetch,settings?:Settings
):Promise<PaperStageDraftInventory>{
 const {key}=configuration(settings);
 let response:Response;
 try{response=await fetcher(ORIGIN+PATH,{
  method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8500),
  headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
   'Content-Type':'application/json',Accept:'application/json'},
  body:'{}'
 });}catch{throw new StagingPaperError('NETWORK');}
 if(!response.ok)throw new StagingPaperError('UPSTREAM_ERROR');
 let body:string;
 try{body=await response.text();}catch{throw new StagingPaperError('NETWORK');}
 if(body.length>12000)throw new StagingPaperError('BAD_RESPONSE');
 let raw:unknown;
 try{raw=JSON.parse(body) as unknown;}catch{throw new StagingPaperError('BAD_RESPONSE');}
 return validateDraftInventory(raw);
}
