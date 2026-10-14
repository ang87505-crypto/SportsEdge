import {NextRequest} from 'next/server';
import {getAlpacaPaperSnapshot,PaperConnectionError} from '@/lib/server/alpaca-paper-reader';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';

// The diagnostic bearer API is separate. This owner-only view never accepts
// secrets via query strings or client storage and never issues broker orders.
const NO_STORE={'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
export async function GET(req:NextRequest) {
  const secret=ownerSecret();
  if(!secret)return Response.json({status:'owner_access_not_configured'},{status:503,headers:NO_STORE});
  if(!validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret))
    return Response.json({status:'owner_access_required'},{status:401,headers:NO_STORE});
  if(new URL(req.url).search)return Response.json({status:'parameters_not_supported'},{status:400,headers:NO_STORE});
  const keyId=process.env.ALPACA_PAPER_KEY_ID,secretKey=process.env.ALPACA_PAPER_SECRET_KEY;
  if(!keyId||!secretKey)
    return Response.json({status:'paper_broker_not_configured'},{status:503,headers:NO_STORE});
  try {
    const snapshot=await getAlpacaPaperSnapshot({keyId,secretKey});
    return Response.json(snapshot,{headers:NO_STORE});
  } catch(error) {
    const safe=error instanceof PaperConnectionError?
      {reason:error.reason,stage:error.stage}:{reason:'PAPER_UNEXPECTED_ERROR',stage:'unknown'};
    return Response.json({status:'paper_broker_unavailable_or_unverified',...safe},{status:503,headers:NO_STORE});
  }
}
