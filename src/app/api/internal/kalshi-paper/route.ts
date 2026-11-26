import {NextRequest} from 'next/server';
import {OWNER_COOKIE,handleKalshiOwnerGet,handleKalshiOwnerPost} from '@/lib/server/kalshi-platform-owner';
export const maxDuration=60;
const json=(result:{status:number;body:unknown})=>Response.json(result.body,{status:result.status,
 headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
export async function GET(req:NextRequest){
 return json(await handleKalshiOwnerGet({url:req.url,ownerCookie:req.cookies.get(OWNER_COOKIE)?.value}));
}
export async function POST(req:NextRequest){
 return json(await handleKalshiOwnerPost({url:req.url,ownerCookie:req.cookies.get(OWNER_COOKIE)?.value,
  origin:req.headers.get('origin'),readBody:async()=>{
   if(!req.body)throw Error('body');const reader=req.body.getReader();let size=0,text='';const decoder=new TextDecoder();
   for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;
    if(size>4096){await reader.cancel();throw Error('body');}text+=decoder.decode(p.value,{stream:true});}
   return JSON.parse(text+decoder.decode());
  }}));
}
