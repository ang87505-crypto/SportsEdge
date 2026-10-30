import {connection,type NextRequest} from 'next/server';
import {OWNER_COOKIE} from '@/lib/server/alpaca-owner-session';
import {handlePaperAutoGet,handlePaperAutoPost,type OwnerRequest} from '@/lib/server/paper-auto-owner';

export const maxDuration=30;
const input=(req:NextRequest):OwnerRequest=>({url:req.url,ownerCookie:req.cookies.get(OWNER_COOKIE)?.value,
 origin:req.headers.get('origin'),contentType:req.headers.get('content-type'),text:()=>req.text()});
/** OWNER-ONLY recurring PAPER status and evidence from the staging ledger. Never contacts a broker. */
export async function GET(req:NextRequest){
 // Under Cache Components a GET handler is prerendered unless it reaches request-time data first.
 await connection();
 return handlePaperAutoGet(input(req),process.env);
}
/** OWNER-ONLY STOP, pause, resume and alert acknowledgement. Never contacts a broker. */
export async function POST(req:NextRequest){
 return handlePaperAutoPost(input(req),process.env);
}
