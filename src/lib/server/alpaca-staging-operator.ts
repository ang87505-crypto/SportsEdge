/**
 * Alpaca PAPER staging-only status and monotonic STOP RPC adapter.
 * SERVER ROUTES ONLY. Must not be imported from a client component.
 * No Alpaca broker call, no order creation, no resume method.
 */
const STAGING_HOST='mcaxfaaohyencpspalfe.supabase.co';
const MAX_BODY_BYTES=8192;
export type StagePaperStatus={
 environment:'SportsEdge Staging';accountKind:'paper';
 halted:true;gateConfigured:boolean;
 storedIntentCount:number;unresolvedReceiptCount:number;haltAuditEvents:number;
 executionPermitted:false;automaticOrdersEnabled:false;realMoneyOrdersEnabled:false;
};
export class StagingPaperError extends Error{
 readonly code:'NOT_CONFIGURED'|'INVALID_CONFIG'|'UPSTREAM_ERROR'|'BAD_RESPONSE'|'NETWORK';
 constructor(code:StagingPaperError['code']){
  super('Staging paper safety status unavailable');
  this.name='StagingPaperError';this.code=code;
 }
}
type Settings={url:string;key:string};
function configuration(settings?:Settings):Settings{
 const raw=settings??{url:process.env.SPORTSEDGE_STAGING_SUPABASE_URL??'',
  key:process.env.SPORTSEDGE_STAGING_SUPABASE_SERVICE_KEY??''};
 if(!raw.url||!raw.key)throw new StagingPaperError('NOT_CONFIGURED');
 let uri:URL;
 try{uri=new URL(raw.url);}catch{throw new StagingPaperError('INVALID_CONFIG');}
 if(uri.protocol!=='https:'||uri.hostname!==STAGING_HOST||
   (uri.pathname!==''&&uri.pathname!=='/')||uri.username||uri.password||
   uri.port||uri.search||uri.hash||raw.key.length<24||raw.key.length>4000)
  throw new StagingPaperError('INVALID_CONFIG');
 return {url:uri.origin,key:raw.key};
}
function validateResult(raw:unknown):StagePaperStatus{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new StagingPaperError('BAD_RESPONSE');
 const x=raw as Record<string,unknown>;
 if(x.environment!=='SportsEdge Staging'||x.accountKind!=='paper'||
   x.halted!==true||typeof x.gateConfigured!=='boolean'||
   x.executionPermitted!==false||x.automaticOrdersEnabled!==false||
   x.realMoneyOrdersEnabled!==false||
   !['storedIntentCount','unresolvedReceiptCount','haltAuditEvents'].every(k=>
    Number.isSafeInteger(x[k])&&(x[k] as number)>=0))
   throw new StagingPaperError('BAD_RESPONSE');
 return {environment:'SportsEdge Staging',accountKind:'paper',halted:true,
  gateConfigured:x.gateConfigured,
  storedIntentCount:x.storedIntentCount as number,
  unresolvedReceiptCount:x.unresolvedReceiptCount as number,
  haltAuditEvents:x.haltAuditEvents as number,
  executionPermitted:false,automaticOrdersEnabled:false,realMoneyOrdersEnabled:false};
}
/** Fixed-schema staging PostgREST RPC call; credentials never appear in the response. */
async function request(kind:'status'|'halt',fetcher:typeof fetch,settings?:Settings):Promise<StagePaperStatus>{
 const {url,key}=configuration(settings);
 const endpoint=kind==='status'?'sportsedge_paper_stage_status':'sportsedge_paper_stage_halt';
 let response:Response;
 try{response=await fetcher(url+'/rest/v1/rpc/'+endpoint,{
  method:'POST', // Supabase RPC POST, NOT an Alpaca order submission
  headers:{apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),
   'Content-Type':'application/json','Accept':'application/json'},
  body:'{}',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8500)
 });}
 catch{throw new StagingPaperError('NETWORK');}
 if(!response.ok)throw new StagingPaperError('UPSTREAM_ERROR');
 let body:string;
 try{body=await response.text();}catch{throw new StagingPaperError('NETWORK');}
 if(body.length>MAX_BODY_BYTES)throw new StagingPaperError('BAD_RESPONSE');
 let raw:unknown;
 try{raw=JSON.parse(body) as unknown;}catch{throw new StagingPaperError('BAD_RESPONSE');}
 return validateResult(raw);
}
export function getStagingPaperStatus(fetcher:typeof fetch=fetch,settings?:Settings){
 return request('status',fetcher,settings);
}
/** Monotonic staging HALT request: no resume or trade functionality exists. */
export function haltStagingPaperExecution(fetcher:typeof fetch=fetch,settings?:Settings){
 return request('halt',fetcher,settings);
}
