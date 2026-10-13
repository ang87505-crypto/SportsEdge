import {timingSafeEqual} from 'node:crypto';
import {getAlpacaPaperSnapshot} from '@/lib/server/alpaca-paper-reader';

// Admin-only bearer, not an owner browser login. Do not import this endpoint into
// client components or put the bearer in NEXT_PUBLIC_* / browser localStorage.
const NO_STORE={'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'};
function isAuthorized(request:Request) {
  const expected=process.env.SPORTSEDGE_ALPACA_PAPER_READ_TOKEN;
  if(!expected||expected.length<32)return false;
  const got=Buffer.from(request.headers.get('authorization')??'');
  const known=Buffer.from('Bearer '+expected);
  return got.length===known.length && timingSafeEqual(got,known);
}
export async function GET(request:Request) {
  if(!isAuthorized(request))return Response.json({error:'Not found'},{
    status:404,headers:NO_STORE
  });
  if(new URL(request.url).search) {
    return Response.json({error:'Parameters not supported'},{status:400,headers:NO_STORE});
  }
  const keyId=process.env.ALPACA_PAPER_KEY_ID;
  const secretKey=process.env.ALPACA_PAPER_SECRET_KEY;
  if(!keyId||!secretKey)return Response.json({status:'not_configured'},{
    status:503,headers:NO_STORE
  });
  try{
    const snapshot=await getAlpacaPaperSnapshot({keyId,secretKey});
    return Response.json(snapshot,{headers:NO_STORE});
  } catch {
    // Never echo upstream errors, tokens, raw account IDs or provider headers.
    return Response.json({status:'paper_broker_unavailable_or_unverified'},{
      status:503,headers:NO_STORE
    });
  }
}
