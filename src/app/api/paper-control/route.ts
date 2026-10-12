import {createPaperHandlers} from '@/lib/paper-control';
import {ownerIdentity} from '@/lib/server/paper-owner';
import {settleResearch} from '@/lib/server/research-operations';
import {runNbaBatchWithReceipt,lookupNbaCommandReceipt} from '@/lib/server/paper-command-receipts';
const handlers=createPaperHandlers({
 origin:()=>process.env.SPORTSEDGE_SITE_ORIGIN,
 identity:ownerIdentity,
 enabled:()=>process.env.SPORTSEDGE_PAPER_RUNS_ENABLED==='true',
 runCommand:runNbaBatchWithReceipt,
 commandStatus:lookupNbaCommandReceipt,
 refresh:settleResearch,
});
export const GET=handlers.GET;
export const POST=handlers.POST;
