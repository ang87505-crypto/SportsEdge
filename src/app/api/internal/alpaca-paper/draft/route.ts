import {NextRequest} from 'next/server';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';
import {createUnapprovedPaperTestDraft,validateManualPaperDraft}
 from '@/lib/server/alpaca-staging-manual-preview';
import {StagingPaperError} from '@/lib/server/alpaca-staging-operator';

export const maxDuration=30;
const HEADERS={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
const json=(body:Record<string,unknown>,status=200)=>Response.json(body,{status,headers:HEADERS});
/** Owner-only saves a NON-EXECUTABLE manual stock test draft in locked Staging.
 * No stock signal/quote is trusted; no Alpaca call, approval or order submission.
 */
export async function POST(req:NextRequest){
 const secret=ownerSecret();
 if(!secret||!validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret))
  return json({status:'owner_access_required'},401);
 if(req.headers.get('origin')!==new URL(req.url).origin)
  return json({status:'origin_rejected'},403);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')
  return json({status:'invalid_request'},400);
 let input:unknown;
 try{
  const raw=await req.text();
  if(raw.length>160)return json({status:'invalid_request'},400);
  input=validateManualPaperDraft(JSON.parse(raw) as unknown);
 }catch{return json({status:'invalid_request'},400);}
 try{
  const draft=await createUnapprovedPaperTestDraft(input);
  return json({status:'draft_saved_not_approved',draft,
   priceVerified:false,signalVerified:false,brokerOrderSubmitted:false,
   executionPermitted:false});
 }catch(error){
  return json({status:'staging_draft_unavailable',
   reason:error instanceof StagingPaperError?error.code:'UNEXPECTED',
   brokerOrderSubmitted:false,executionPermitted:false},503);
 }
}
