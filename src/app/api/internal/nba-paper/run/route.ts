import {NextRequest} from 'next/server';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';
import {previewOneNbaPaperBet,recordOneNbaPaperBet,NbaPaperRunError}
 from '@/lib/server/nba-paper-once';

export const maxDuration=60;
const HEADERS={'Cache-Control':'private, no-store, max-age=0',
 'Pragma':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const json=(v:Record<string,unknown>,status=200)=>Response.json(v,{status,headers:HEADERS});
function authorized(req:NextRequest){
 const secret=ownerSecret();
 return !!secret&&validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret);
}
export async function GET(req:NextRequest){
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 if(!authorized(req))return json({status:'owner_access_required'},401);
 try{return json(await previewOneNbaPaperBet());}
 catch{return json({status:'preview_unavailable',realMoneyEnabled:false},503);}
}
export async function POST(req:NextRequest){
 if(!authorized(req))return json({status:'owner_access_required'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)
  return json({status:'origin_rejected'},403);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')
  return json({status:'invalid_request'},400);
 let body:unknown;
 try{
  const raw=await req.text();
  if(raw.length>160)return json({status:'invalid_request'},400);
  body=JSON.parse(raw) as unknown;
 }catch{return json({status:'invalid_request'},400);}
 try{return json(await recordOneNbaPaperBet(body));}
 catch(e){
  if(e instanceof NbaPaperRunError&&e.code==='INVALID_REQUEST')
   return json({status:'invalid_request'},400);
  if(e instanceof NbaPaperRunError&&
    ['NO_ELIGIBLE_BET','PREVIEW_EXPIRED_OR_CHANGED'].includes(e.code))
   return json({status:'no_eligible_or_current_approval',reason:e.code,
    recorded:false,realMoneyEnabled:false},409);
  // Ambiguous provider/DB response: position may already exist. Never retry.
  return json({status:'virtual_write_unverified_review_ledger',
   retryAutomatically:false,realMoneyEnabled:false},503);
 }
}
