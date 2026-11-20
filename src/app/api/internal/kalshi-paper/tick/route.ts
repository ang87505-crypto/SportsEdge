import {NextRequest} from 'next/server';
import {handleKalshiTick} from '@/lib/server/kalshi-platform-owner';
export const maxDuration=60;
export async function GET(req:NextRequest){
 const result=await handleKalshiTick({authorization:req.headers.get('authorization')});
 return Response.json(result.body,{status:result.status,headers:{'Cache-Control':'no-store'}});
}
