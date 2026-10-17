/**
 * Admin-only bearer diagnostic for the Alpaca PAPER account. Read-only; never
 * an owner browser login and never an order path. The route must call
 * `await connection()` before this runs, or Cache Components prerenders the
 * unauthenticated 404 at build time and every real request receives it.
 */
import {timingSafeEqual} from 'node:crypto';
import {getAlpacaPaperSnapshot,PaperConnectionError} from './alpaca-paper-reader.ts';

// Reads SPORTSEDGE_ALPACA_PAPER_READ_TOKEN, ALPACA_PAPER_KEY_ID, ALPACA_PAPER_SECRET_KEY.
type DiagnosticEnv=Readonly<Record<string,string|undefined>>;
type SnapshotReader=(settings:{keyId:string;secretKey:string})=>Promise<unknown>;
const NO_STORE={'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'};

export function isDiagnosticAuthorized(authorization:string|null,expected:string|undefined):boolean {
  if(!expected||expected.length<32)return false;
  const got=Buffer.from(authorization??'');
  const known=Buffer.from('Bearer '+expected);
  return got.length===known.length && timingSafeEqual(got,known);
}
export async function handleDiagnosticRequest(
  request:Request,env:DiagnosticEnv,readSnapshot:SnapshotReader=getAlpacaPaperSnapshot
):Promise<Response> {
  if(!isDiagnosticAuthorized(request.headers.get('authorization'),env.SPORTSEDGE_ALPACA_PAPER_READ_TOKEN))
    return Response.json({error:'Not found'},{status:404,headers:NO_STORE});
  if(new URL(request.url).search) {
    return Response.json({error:'Parameters not supported'},{status:400,headers:NO_STORE});
  }
  const keyId=env.ALPACA_PAPER_KEY_ID;
  const secretKey=env.ALPACA_PAPER_SECRET_KEY;
  if(!keyId||!secretKey)return Response.json({status:'not_configured'},{
    status:503,headers:NO_STORE
  });
  try{
    const snapshot=await readSnapshot({keyId,secretKey});
    return Response.json(snapshot,{headers:NO_STORE});
  } catch(error) {
    // Only fixed, bounded diagnostic codes leave the server. Never echo
    // upstream error bodies, credentials, request headers or account IDs.
    const diagnostic=error instanceof PaperConnectionError
      ? {reason:error.reason,stage:error.stage}
      : {reason:'PAPER_UNEXPECTED_ERROR',stage:'unknown'};
    return Response.json({
      status:'paper_broker_unavailable_or_unverified',...diagnostic
    },{status:503,headers:NO_STORE});
  }
}
