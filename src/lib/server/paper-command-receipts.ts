import 'server-only';
import {guardedNbaRun,type CommandClaim,type PaperCommandStore} from '@/lib/paper-command';
import {placeResearch} from './research-operations';

const ACCOUNT='nba-elo-research-v1';
type Receipt={id:string;owner_id:string;account_slug:string;action:'run';state:'running'|'completed'|'uncertain';summary:unknown};
class ReceiptRequestError extends Error{constructor(readonly status:number){super('Private command store unavailable');}}
function backend(){
 const address=process.env.SUPABASE_URL;
 const key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
 const owner=process.env.SPORTSEDGE_OWNER_USER_ID;
 if(!address||!key||!owner||!/^[0-9a-f-]{36}$/i.test(owner))throw Error('Owner command receipt storage is not configured');
 const url=new URL(address);
 if(url.protocol!=='https:'||!url.hostname.endsWith('.supabase.co')||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid owner command storage URL');
 return {base:url.origin,key,owner:owner.toLowerCase()};
}
async function commandDb<T>(route:string,method:'GET'|'POST'|'PATCH'='GET',data?:object):Promise<T>{
 const {base,key}=backend();
 const response=await fetch(`${base}/rest/v1/${route}`,{
  method,
  headers:{
   apikey:key,
   ...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{}),
   Accept:'application/json',
   'Content-Type':'application/json',
   ...(method!=='GET'?{Prefer:'return=representation'}:{})
  },
  body:data===undefined?undefined:JSON.stringify(data),
  cache:'no-store',signal:AbortSignal.timeout(12000)
 });
 if(!response.ok)throw new ReceiptRequestError(response.status);
 const raw=await response.text();
 return (raw?JSON.parse(raw):null) as T;
}
function receiptMatch(r:Receipt,id:string,owner:string){
 return r.id===id&&r.owner_id.toLowerCase()===owner&&r.account_slug===ACCOUNT&&r.action==='run';
}
export function nbaReceiptStore():PaperCommandStore{
 const {owner}=backend();
 async function read(commandId:string):Promise<Receipt|null>{
  const rows=await commandDb<Receipt[]>(`paper_command_receipts?select=id,owner_id,account_slug,action,state,summary&id=eq.${commandId}&limit=1`);
  return rows.length===1?rows[0]:null;
 }
 function previous(row:Receipt,commandId:string):CommandClaim{
  if(!receiptMatch(row,commandId,owner))return {state:'blocked'};
  return row.state==='completed'?{state:'replayed',result:row.summary}:{state:'blocked'};
 }
 return {
  async claim(commandId){
   const existing=await read(commandId);
   if(existing)return previous(existing,commandId);
   try{
    const rows=await commandDb<Receipt[]>('paper_command_receipts','POST',{
     id:commandId,owner_id:owner,account_slug:ACCOUNT,action:'run',state:'running',summary:null
    });
    if(rows.length!==1||!receiptMatch(rows[0],commandId,owner)||rows[0].state!=='running')throw Error('Invalid durable receipt');
    return {state:'claimed'};
   }catch(error){
    // Unique command ID or account-wide active/uncertain-slot conflicts are 409.
    // A successful insert with lost HTTP response is never retried.
    if(error instanceof ReceiptRequestError&&error.status!==409)throw error;
    const latest=await read(commandId);
    if(latest)return previous(latest,commandId);
    if(error instanceof ReceiptRequestError&&error.status===409)return {state:'blocked'};
    throw error;
   }
  },
  async finish(commandId,state,result){
   const updated=await commandDb<Receipt[]>(`paper_command_receipts?id=eq.${commandId}&owner_id=eq.${owner}&account_slug=eq.${ACCOUNT}&state=eq.running`,'PATCH',{
    state,summary:result??null,finished_at:new Date().toISOString()
   });
   if(updated.length!==1||!receiptMatch(updated[0],commandId,owner)||updated[0].state!==state)throw Error('Command completion not confirmed');
  }
 };
}
export async function runNbaBatchWithReceipt(commandId:string){
 // The HTTP route has already verified the Supabase-authenticated owner and opt-in flag.
 // A missing table, incorrect secret or unauthorized DB request fails CLOSED before run().
 try{return await guardedNbaRun(commandId,nbaReceiptStore(),()=>placeResearch(10));}
 catch{return {state:'unavailable' as const};}
}

/** Read-only owner lookup. The handler authenticates the owner before calling. */
export async function lookupNbaCommandReceipt(commandId:string){
 const {owner}=backend();
 const rows=await commandDb<Receipt[]>(`paper_command_receipts?select=id,owner_id,account_slug,action,state,summary&id=eq.${commandId}&limit=1`);
 if(rows.length===0)return {state:'not_found' as const};
 if(rows.length!==1||!receiptMatch(rows[0],commandId,owner))throw Error('Receipt identity mismatch');
 const receipt=rows[0];
 return receipt.state==='completed'
  ?{state:'completed' as const,result:receipt.summary}
  :{state:receipt.state};
}
