import {connection} from 'next/server';
import {handleMoneylineRefresh} from '@/lib/server/moneyline-refresh';
import {researchDb} from '@/lib/server/research-db';
import {collectDualTracks} from '@/lib/server/collect/odds-collector';

export const maxDuration=60;

type Row={observed_at:string;ingested_at:string};
/** Newest stored h2h snapshot, read through the same server-only database client as /api/sports. */
async function latestH2h(){
 const rows=await researchDb<Row[]>('odds_snapshots?select=observed_at,ingested_at&market=eq.h2h&order=ingested_at.desc,id.desc&limit=1');
 return {observedAt:rows[0]?.observed_at??null,ingestedAt:rows[0]?.ingested_at??null};
}

/** Once-daily Vercel cron. Exits before any network call while MONEYLINE_REFRESH_RELEASE is off. */
export async function GET(req:Request){
 await connection();
 const result=await handleMoneylineRefresh(req,process.env,{now:()=>Date.now(),latestH2h,
  reserve:track=>researchDb<boolean>('rpc/research_reserve_credit',{p_track:track}),
  collect:()=>collectDualTracks()});
 // Fixed outcome codes and counts only. Never log headers, provider URLs or keys.
 console.info('moneyline-refresh',result.status,await result.clone().text());
 return result;
}
