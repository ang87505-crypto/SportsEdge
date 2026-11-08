import {connection,type NextRequest} from 'next/server';
import {OWNER_COOKIE} from '@/lib/server/alpaca-owner-session';
import {handlePropsOwnerGet,handlePropsOwnerPost,type PropsOwnerRequest} from '@/lib/server/props-owner';

export const maxDuration=30;
const input=(req:NextRequest):PropsOwnerRequest=>({url:req.url,ownerCookie:req.cookies.get(OWNER_COOKIE)?.value,
 origin:req.headers.get('origin'),contentType:req.headers.get('content-type'),text:()=>req.text()});
/** OWNER-ONLY: current props control. Read-only. */
export async function GET(req:NextRequest){
 await connection();
 return handlePropsOwnerGet(input(req),process.env);
}
/** OWNER-ONLY: pause, resume or stop the props PAPER worker. One database call; no collection or settlement. */
export async function POST(req:NextRequest){
 return handlePropsOwnerPost(input(req),process.env);
}
