import {NextRequest} from 'next/server';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';
import {listUnapprovedStagingDrafts} from '@/lib/server/alpaca-staging-draft-review';
import {StagingPaperError} from '@/lib/server/alpaca-staging-operator';
export const maxDuration=30;
const NO_STORE={'Cache-Control':'private, no-store, max-age=0',
 'Pragma':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
function json(body:Record<string,unknown>,status=200){
 return Response.json(body,{status,headers:NO_STORE});
}
/** Only the session owner may inspect unapproved staging receipts.
 * There is no action to approve, submit, delete, retry, or schedule.
 */
export async function GET(req:NextRequest){
 const secret=ownerSecret();
 if(!secret||!validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret))
  return json({status:'owner_access_required'},401);
 if(new URL(req.url).search)return json({status:'parameters_not_supported'},400);
 try{
  return json({status:'staging_drafts_read_only',
   data:await listUnapprovedStagingDrafts(),
   brokerOrderSubmitted:false,executionPermitted:false});
 }catch(e){
  return json({status:'staging_drafts_unavailable',
   reason:e instanceof StagingPaperError?e.code:'UNEXPECTED',
   brokerOrderSubmitted:false,executionPermitted:false},503);
 }
}
