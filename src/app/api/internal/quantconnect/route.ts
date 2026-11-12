import {timingSafeEqual} from 'node:crypto';
import {listQuantConnect,verifyQuantConnect} from '@/lib/server/quantconnect-client';

function authorized(request:Request) {
  const token=process.env.SPORTSEDGE_QC_READ_TOKEN;
  if(!token||token.length<32)return false;
  const supplied=Buffer.from(request.headers.get('authorization')??'');
  const expected=Buffer.from('Bearer '+token);
  return supplied.length===expected.length && timingSafeEqual(supplied,expected);
}
const cacheHeaders={'Cache-Control':'private, no-store','Pragma':'no-cache'};
export async function GET(request:Request) {
  // This endpoint is NOT public dashboard authentication. An independent
  // owner-authenticated session UI must be built before browser consumption.
  if(!authorized(request))return Response.json({error:'Not found'},{status:404,headers:cacheHeaders});
  const url=new URL(request.url);
  const mode=url.searchParams.get('action')??'verify';
  if((mode!=='verify'&&mode!=='list') || [...url.searchParams.keys()].some(k=>k!=='action')) {
    return Response.json({error:'Unsupported read-only action'},{status:400,headers:cacheHeaders});
  }
  const userId=process.env.QC_USER_ID,apiToken=process.env.QC_API_TOKEN;
  const projectId=Number(process.env.QC_PROJECT_ID);
  if(!userId||!apiToken||!Number.isSafeInteger(projectId)||projectId<=0) {
    return Response.json({status:'not_configured'},{status:503,headers:cacheHeaders});
  }
  try{
    const config={userId,apiToken,projectId};
    const result=mode==='verify'?await verifyQuantConnect(config):await listQuantConnect(config);
    return Response.json(result,{headers:cacheHeaders});
  }catch{
    // Never return QC credentials, raw provider response or upstream error body.
    return Response.json({status:'quantconnect_unavailable_or_denied'},{
      status:503,headers:cacheHeaders
    });
  }
}
