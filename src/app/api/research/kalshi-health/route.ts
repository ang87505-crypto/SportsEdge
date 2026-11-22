import {connection} from 'next/server';
import {loadKalshiResearchHealth} from '@/lib/server/kalshi-research-health';

export async function GET(){
 await connection();
 const health=await loadKalshiResearchHealth(new Date().toISOString());
 return Response.json(health,{status:health.state==='UNAVAILABLE'?503:200,
  headers:{'Cache-Control':'public, max-age=0, s-maxage=60'}});
}
