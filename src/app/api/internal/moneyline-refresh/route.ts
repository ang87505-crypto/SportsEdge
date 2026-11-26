import {connection} from 'next/server';
import {handleMoneylineRefresh} from '@/lib/server/moneyline-refresh';
import {researchDb} from '@/lib/server/research-db';

export const maxDuration=30;

/** Once-daily Vercel cron. Exits before any network call while MONEYLINE_REFRESH_RELEASE is off. When on, it only
 * claims today's slot in the database, which dispatches the existing research-cycle run. No provider call here. */
export async function GET(req:Request){
 await connection();
 const result=await handleMoneylineRefresh(req,process.env,{now:()=>Date.now(),
  dispatchSlot:slot=>researchDb('rpc/research_refresh_slot_dispatch',{p_slot:slot})});
 // Fixed outcome codes, the slot and the dispatch result only. Never log headers or keys.
 console.info('moneyline-refresh',result.status,await result.clone().text());
 return result;
}
