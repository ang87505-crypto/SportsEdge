import {NextRequest} from 'next/server';
import {OWNER_COOKIE,ownerSecret,validOwnerSession} from '@/lib/server/alpaca-owner-session';
import {getAlpacaPaperSnapshot,PaperConnectionError} from '@/lib/server/alpaca-paper-reader';
import {readCompletePaperOrderInventory,PaperReconciliationError} from '@/lib/server/alpaca-paper-reconciliation';

export const maxDuration=60;
const NO_STORE={
 'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'
};
function result(payload:Record<string,unknown>,status=200){
 return Response.json(payload,{status,headers:NO_STORE});
}
/** Owner-only, manually invoked, account PAPER ONLY, read-only API GET.
 * No POST handler, no scheduler, no order permissions, no writes, no raw IDs.
 * Broker paging is not an atomic snapshot and does not authorize execution.
 */
export async function GET(req:NextRequest){
 if(new URL(req.url).search)return result({status:'parameters_not_supported'},400);
 const secret=ownerSecret();
 if(!secret)return result({status:'owner_access_not_configured'},503);
 if(!validOwnerSession(req.cookies.get(OWNER_COOKIE)?.value,secret))
  return result({status:'owner_access_required'},401);
 const keyId=process.env.ALPACA_PAPER_KEY_ID;
 const secretKey=process.env.ALPACA_PAPER_SECRET_KEY;
 if(!keyId||!secretKey)return result({status:'paper_broker_not_configured'},503);
 const config={keyId,secretKey};
 try{
  const account=await getAlpacaPaperSnapshot(config);
  if(account.accountType!=='paper'||!account.readOnly||account.realMoneyOrdersEnabled)
   return result({status:'non_paper_broker_denied'},503);
  const inventory=await readCompletePaperOrderInventory(config);
  return result({
   status:'read_only_enumeration',
   source:'Alpaca Paper API',checkedAt:inventory.checkedAt,
   pagesRead:inventory.pageCount,ordersExamined:inventory.totalOrders,
   openOrders:inventory.openOrders.length,
   historyPaginationExhausted:inventory.historyComplete,
   accountType:'paper',automaticPaperOrdersEnabled:false,realMoneyOrdersEnabled:false,
   safeForExecution:false,
   receiptDatabaseLinked:false,
   caveat:'Read-only bounded order enumeration. Concurrent broker changes, fills, order replacements and persistent receipt reconciliation are not independently verified. No orders are authorized.'
  });
 }catch(error){
  const reason=error instanceof PaperReconciliationError?error.reason:
   error instanceof PaperConnectionError?error.reason:'UNVERIFIED_BROKER_READ';
  return result({status:'reconciliation_unavailable',reason,
   automaticPaperOrdersEnabled:false,safeForExecution:false},503);
 }
}
