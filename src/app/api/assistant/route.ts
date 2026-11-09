import type {NextRequest} from 'next/server';
import {handleAssistant} from '@/lib/server/assistant-handler';
import {loadPropsDashboardFrom} from '@/lib/server/props-dashboard-load';
import {propsStore} from '@/lib/server/props-store';

export const maxDuration=30;
/** Read-only questions about the PrizePicks paper test. No writes; messages are not stored. */
export async function POST(req:NextRequest){
 return handleAssistant({contentType:req.headers.get('content-type'),text:()=>req.text()},process.env,
  nowIso=>loadPropsDashboardFrom(propsStore(),nowIso),new Date().toISOString());
}
