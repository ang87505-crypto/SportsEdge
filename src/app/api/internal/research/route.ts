import {timingSafeEqual} from 'node:crypto';
import {publishResearch,placeResearch,settleResearch} from '@/lib/server/research-operations';
export async function POST(request:Request){
 const token=process.env.SPORTSEDGE_INGEST_TOKEN,a=Buffer.from(request.headers.get('authorization')??''),b=Buffer.from(token?`Bearer ${token}`:'');
 if(!token||token.length<32||a.length!==b.length||!timingSafeEqual(a,b))return Response.json({error:'Not found'},{status:404});
 try{
  const body=await request.json();
  const result=body.action==='publish'?await publishResearch():body.action==='paper'?await placeResearch():body.action==='settle'?await settleResearch():null;
  if(result===null)return Response.json({error:'Unsupported action'},{status:400});
  return Response.json(result,{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Research operation failed; audit required'},{status:503,headers:{'Cache-Control':'private, no-store'}});}
}
