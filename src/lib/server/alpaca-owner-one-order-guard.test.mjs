import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rd=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('Owner first-order route is branch-preview-only, authenticated and no cron',()=>{
 const src=rd('../../app/api/internal/alpaca-paper/one-order/route.ts');
 const writer=rd('./alpaca-owner-first-order.ts');
 const sql=rd('../../../database/staging/alpaca_paper_first_order_v6.sql');
 const flags=rd('../stocks/paper-automation-release.ts');
 for(const v of ["validOwnerSession","req.headers.get('origin')",
  'acceptance/alpaca-paper-first-order',"VERCEL_ENV==='preview'",
  'SUBMIT_ONE_ALPACA_PAPER_ORDER','inspectFirstPaperOrder'])
  assert.ok(src.includes(v),v);
 for(const v of ['placeOrdersEnabled:false','scheduledOrdersEnabled:false',
   'realMoneyEnabled:false'])assert.ok(flags.includes(v));
 assert.ok(writer.includes('https://paper-api.alpaca.markets/v2/orders'));
 assert.ok(!writer.includes('https://api.alpaca.markets/v2/orders'));
 assert.ok(sql.includes('alpaca_paper_first_order_lifetime_once'));
 assert.ok(sql.includes("o.status='owner_approved'"));
 assert.ok(!src.includes('export async function DELETE'));
 assert.ok(!src.includes('NEXT_PUBLIC_'));
});
