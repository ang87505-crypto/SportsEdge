import {NextRequest,NextResponse} from 'next/server';
import {OWNER_COOKIE,OWNER_SESSION_SECONDS,issueOwnerSession,ownerSecret,secureTextEquals} from '@/lib/server/alpaca-owner-session';

const NO_STORE={'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
function json(value:Record<string,unknown>,status:number) {
  return NextResponse.json(value,{status,headers:NO_STORE});
}
function sameOrigin(req:NextRequest):boolean {
  const origin=req.headers.get('origin');
  return !!origin&&origin===new URL(req.url).origin;
}
// No permissive CORS, no user-provided URLs, no diagnostic bearer in browser.
export async function POST(req:NextRequest) {
  if(!sameOrigin(req))return json({status:'origin_rejected'},403);
  const secret=ownerSecret();
  if(!secret)return json({status:'owner_access_not_configured'},503);
  if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')
    return json({status:'invalid_request'},400);
  let body:unknown;
  try {
    const raw=await req.text();
    if(raw.length>256)return json({status:'invalid_request'},400);
    body=JSON.parse(raw) as unknown;
  } catch{return json({status:'invalid_request'},400);}
  if(!body||typeof body!=='object'||Array.isArray(body)||
    typeof (body as Record<string,unknown>).ownerKey!=='string'||
    !secureTextEquals((body as {ownerKey:string}).ownerKey,secret)) {
    return json({status:'owner_access_denied'},401);
  }
  const response=json({status:'authenticated',readOnly:true},200);
  response.cookies.set(OWNER_COOKIE,issueOwnerSession(secret),{
    httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:OWNER_SESSION_SECONDS
  });
  return response;
}
export async function DELETE(req:NextRequest) {
  if(!sameOrigin(req))return json({status:'origin_rejected'},403);
  const response=json({status:'signed_out'},200);
  response.cookies.set(OWNER_COOKIE,'',{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0});
  return response;
}
