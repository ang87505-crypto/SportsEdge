import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../../../',import.meta.url);
const file=path=>readFileSync(new URL(path,root),'utf8');
test('Paper writer is never wired into any route or scheduled API',()=>{
 const writer=file('src/lib/server/alpaca-paper-one-shot-writer.ts');
 const release=file('src/lib/stocks/paper-automation-release.ts');
 assert.ok(writer.includes('assertPaperWriterReleased(); // FIRST statement'));
 for(const state of [
  'placeOrdersEnabled:false','scheduledOrdersEnabled:false',
  'realMoneyEnabled:false','durableReceiptStoreReady:false',
  'emergencyStopOperational:false','brokerReconciliationComplete:false',
  'verifiedLiveSignalSource:false'
 ])assert.ok(release.includes(state),state);
 const draft=file('src/app/api/internal/alpaca-paper/draft/route.ts');
 const status=file('src/app/api/internal/alpaca-paper/staging/route.ts');
 const inventory=file('src/app/api/internal/alpaca-paper/drafts/route.ts');
 for(const route of [draft,status,inventory]){
  assert.ok(!route.includes('submitApprovedPaperOrderOnce'));
  assert.ok(!route.includes('alpaca-paper-one-shot-writer'));
  assert.ok(!route.includes('paper-api.alpaca.markets/v2/orders'));
 }
 assert.ok(!writer.includes('NEXT_PUBLIC_'));
 assert.ok(!writer.includes("PAPER_URL='https://api.alpaca.markets/v2/orders'"));
});
