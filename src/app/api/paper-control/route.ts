import {createPaperHandlers} from '@/lib/paper-control';
import {ownerIdentity} from '@/lib/server/paper-owner';
import {placeResearch,settleResearch} from '@/lib/server/research-operations';
const handlers=createPaperHandlers({
 origin:()=>process.env.SPORTSEDGE_SITE_ORIGIN,
 identity:ownerIdentity,
 enabled:()=>process.env.SPORTSEDGE_PAPER_RUNS_ENABLED==='true',
 run:()=>placeResearch(10),
 refresh:settleResearch,
});
export const GET=handlers.GET;
export const POST=handlers.POST;
