import {handleResearchCycle,researchCycleEnvironmentReady}
  from '@/lib/server/research-cycle-handler';
import {researchDb} from '@/lib/server/research-db';
import {collectDualTracks} from '@/lib/server/collect/odds-collector';
import {checkIngestionDatabase} from '@/lib/server/collect/readiness';

export const maxDuration=60;

/** Matches the already installed research_dispatch RPC. Refreshes stored
 * markets only; publication and paper placement remain separate operations. */
export async function POST(request:Request){
  return handleResearchCycle(request,{
    enabled:researchCycleEnvironmentReady(process.env),
    claim:(id,hash)=>researchDb('rpc/research_claim',{p_id:id,p_hash:hash}),
    finish:(id,status,summary)=>researchDb('rpc/research_finish',{
      p_id:id,p_status:status,p_summary:summary}),
    reserve:track=>researchDb('rpc/research_reserve_credit',{p_track:track}),
    probe:()=>checkIngestionDatabase(),
    collect:()=>collectDualTracks(),
  });
}
