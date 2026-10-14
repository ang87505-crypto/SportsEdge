/**
 * Records an unapproved, non-executable single-share PAPER test proposal in
 * SportsEdge Staging ONLY. The staging execution gate MUST remain HALTED.
 * No Alpaca network request, quotes, order approval, scheduling, or trading.
 */
import {createHash,randomBytes} from 'node:crypto';
import {StagingPaperError} from './alpaca-staging-operator.ts';

const STAGING_ORIGIN='https://mcaxfaaohyencpspalfe.supabase.co';
const LIMIT_CENTS=2500;
const HEX=/^[a-f0-9]{32}$/;
export type ManualPaperDraftRequest={symbol:string;limitCents:number;shares:1};
export type ManualPaperDraftResult={
 status:'planned';environment:'SportsEdge Staging';accountKind:'paper';
 intentId:string;symbol:string;shares:1;limitCents:number;
 approved:false;executionPermitted:false;brokerCalls:0;gateHalted:true;
};
type Settings={url:string;key:string};

export function validateManualPaperDraft(input:unknown):ManualPaperDraftRequest {
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw new StagingPaperError('BAD_RESPONSE');
 const d=input as Record<string,unknown>;
 if(Object.keys(d).length!==3||typeof d.symbol!=='string'||
   !/^[A-Z][A-Z0-9.-]{0,9}$/.test(d.symbol)||
   d.shares!==1||!Number.isSafeInteger(d.limitCents)||
   (d.limitCents as number)<1||(d.limitCents as number)>LIMIT_CENTS)
  throw new StagingPaperError('BAD_RESPONSE');
 return {symbol:d.symbol,limitCents:d.limitCents as number,shares:1};
}
function env(settings?:Settings) {
 const cfg=settings??{url:process.env.SPORTSEDGE_STAGING_SUPABASE_URL??'',
  key:process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY??''};
 if(!cfg.url||!cfg.key)throw new StagingPaperError('NOT_CONFIGURED');
 let url:URL;
 try{url=new URL(cfg.url);}catch{throw new StagingPaperError('INVALID_CONFIG');}
 if(url.origin!==STAGING_ORIGIN||(url.pathname!==''&&url.pathname!=='/')||
   url.search||url.hash||url.username||url.password||cfg.key.length<24||
   cfg.key.length>4000)
  throw new StagingPaperError('INVALID_CONFIG');
 return {key:cfg.key};
}
function parseResponse(raw:unknown,request:ManualPaperDraftRequest):ManualPaperDraftResult {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))
  throw new StagingPaperError('BAD_RESPONSE');
 const x=raw as Record<string,unknown>;
 if(x.status!=='planned'||x.environment!=='SportsEdge Staging'||x.accountKind!=='paper'||
    x.symbol!==request.symbol||x.limitCents!==request.limitCents||
    x.shares!==1||x.executionPermitted!==false||x.brokerCalls!==0||
    x.approved!==false||x.gateHalted!==true||
    typeof x.intentId!=='string'||!/^preview-[a-f0-9]{32}$/.test(x.intentId))
  throw new StagingPaperError('BAD_RESPONSE');
 return {status:'planned',environment:'SportsEdge Staging',accountKind:'paper',
  intentId:x.intentId,symbol:request.symbol,shares:1,limitCents:request.limitCents,
  approved:false,executionPermitted:false,brokerCalls:0,gateHalted:true};
}
/** Create one persistence-only draft; never re-run automatically after failure.
 * A transport failure is INDETERMINATE for storage: do not blindly retry.
 */
export async function createUnapprovedPaperTestDraft(
 input:unknown,fetcher:typeof fetch=fetch,settings?:Settings
):Promise<ManualPaperDraftResult>{
 const request=validateManualPaperDraft(input);
 const {key}=env(settings);
 const random=randomBytes(16).toString('hex');
 if(!HEX.test(random))throw new StagingPaperError('BAD_RESPONSE');
 const intentId='preview-'+random;
 const clientId='sepaper_'+createHash('sha256')
  .update('sportsedge-unapproved-paper-test-v1\0'+intentId).digest('hex').slice(0,32);
 const sourceDigest=createHash('sha256').update(JSON.stringify([
  'UNVERIFIED_MANUAL_DRAFT_NOT_A_MARKET_SIGNAL',intentId,request.symbol,
  request.shares,request.limitCents
 ])).digest('hex');
 let response:Response;
 try{
  response=await fetcher(STAGING_ORIGIN+'/rest/v1/rpc/sportsedge_paper_stage_preview',{
   method:'POST',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8500),
   headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
    'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({p_intent_id:intentId,p_symbol:request.symbol,
    p_limit_cents:request.limitCents,p_client_order_id:clientId,
    p_source_digest:sourceDigest})
  });
 }catch{throw new StagingPaperError('NETWORK');}
 if(!response.ok)throw new StagingPaperError('UPSTREAM_ERROR');
 let rawText:string;
 try{rawText=await response.text();}catch{throw new StagingPaperError('NETWORK');}
 if(rawText.length>4096)throw new StagingPaperError('BAD_RESPONSE');
 let result:unknown;
 try{result=JSON.parse(rawText) as unknown;}catch{throw new StagingPaperError('BAD_RESPONSE');}
 const parsed=parseResponse(result,request);
 if(parsed.intentId!==intentId)throw new StagingPaperError('BAD_RESPONSE');
 return parsed;
}
