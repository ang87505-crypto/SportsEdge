import type {NextRequest} from 'next/server';
import {handleSiteAssistant,sitePorts,assistantAccess} from '@/lib/server/site-assistant-handler';
import {loadPropsDashboardFrom} from '@/lib/server/props-dashboard-load';
import {propsStore} from '@/lib/server/props-store';
import {OWNER_COOKIE} from '@/lib/server/alpaca-owner-session';

export const maxDuration=30;
/** Read-only sports, stock account and research questions. Messages are not stored. */
export async function POST(req:NextRequest){
 const input={url:req.url,contentType:req.headers.get('content-type'),origin:req.headers.get('origin'),
  ownerCookie:req.cookies.get(OWNER_COOKIE)?.value,text:()=>req.text()};
 return handleSiteAssistant(input,process.env,new Date().toISOString(),
  sitePorts(input,process.env,now=>loadPropsDashboardFrom(propsStore(),now)));
}
/** Session probe only. No account data or provider calls. */
export async function GET(req:NextRequest){
 return Response.json(assistantAccess(req.cookies.get(OWNER_COOKIE)?.value),
  {headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}});
}
