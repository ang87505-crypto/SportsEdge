import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  alpacaPaperHeaders,requirePaperSettings,normalizePaperSnapshot,getAlpacaPaperSnapshot
} from './alpaca-paper-reader.ts';

const auth={keyId:'SYNTHETIC-API-KEY',secretKey:'SYNTHETIC-SECRET-ONLY-NOT-A-KEY'};
const account={status:'ACTIVE',currency:'USD',equity:'1000.00',
  cash:'800.00',portfolio_value:'1000.00',buying_power:'800.00',
  trading_blocked:false,account_blocked:false};
const positions=[{symbol:'AAPL',side:'long',qty:'1',market_value:'200.00'}];
const orders=[{id:'order-000001',status:'filled',symbol:'AAPL',side:'buy',
  created_at:'2026-10-13T13:00:00Z'}];
test('header builder refuses absent secrets and does not return auth in summaries',()=>{
 assert.throws(()=>requirePaperSettings({keyId:'',secretKey:''}));
 assert.throws(()=>requirePaperSettings({keyId:'WRONG',secretKey:'short'}));
 const x=alpacaPaperHeaders(auth);
 assert.equal(x['APCA-API-KEY-ID'],auth.keyId);
 assert.equal(x['APCA-API-SECRET-KEY'],auth.secretKey);
 const s=normalizePaperSnapshot(account,positions,orders,'2026-10-13T14:00:00Z');
 assert.ok(!JSON.stringify(s).includes(auth.secretKey));
 assert.equal(s.automaticPaperOrdersEnabled,false);
 assert.equal(s.realMoneyOrdersEnabled,false);
 assert.equal(s.readOnly,true);
 assert.equal(s.stockSelectionDataVerified,false);
});
test('only paper host and GET account, positions, orders endpoints are used',async()=>{
 const calls=[];
 const responses=[account,positions,orders];
 let i=0;
 const fetcher=async (url,opts)=>{
   calls.push({url,opts});
   return new Response(JSON.stringify(responses[i++]),{status:200});
 };
 const r=await getAlpacaPaperSnapshot(auth,fetcher,()=> '2026-10-13T15:00:00Z');
 assert.deepEqual(calls.map(x=>x.url),[
  'https://paper-api.alpaca.markets/v2/account',
  'https://paper-api.alpaca.markets/v2/positions',
  'https://paper-api.alpaca.markets/v2/orders?status=all&limit=25&direction=desc'
 ]);
 assert.ok(calls.every(x=>x.opts.method==='GET'&&x.opts.cache==='no-store'&&x.opts.redirect==='error'));
 assert.deepEqual(r.warnings,[]);
 assert.equal(r.account.equityUsd,'1000.00');
 assert.equal(r.positions[0].symbol,'AAPL');
 assert.equal(r.recentOrders.length,1);
 assert.equal(r.completeOrderHistoryVerified,false);
});
test('flags blocked account, shorts and open orders without permitting automation',()=>{
 const a={...account,trading_blocked:true};
 const p=[{...positions[0],side:'short'}];
 const o=[{...orders[0],status:'accepted'}];
 const r=normalizePaperSnapshot(a,p,o,'2026-10-13T15:00:00Z');
 assert.deepEqual(r.warnings,[
   'ACCOUNT_BLOCKED','SHORT_POSITION_PRESENT','OPEN_ORDER_REQUIRES_RECONCILIATION'
 ]);
 assert.equal(r.state,'READ_ONLY_DIAGNOSTIC_NOT_EXECUTION_AUTHORIZATION');
});
test('fails closed on duplicate identity, unexpected schema and invalid money',()=>{
 assert.throws(()=>normalizePaperSnapshot(account,[...positions,...positions],orders,'2026-10-13T15:00:00Z'));
 assert.throws(()=>normalizePaperSnapshot(account,positions,[...orders,...orders],'2026-10-13T15:00:00Z'));
 assert.throws(()=>normalizePaperSnapshot({...account,cash:'NaN'},positions,orders,'2026-10-13T15:00:00Z'));
 assert.throws(()=>normalizePaperSnapshot({...account,currency:'BTC'},positions,orders,'2026-10-13T15:00:00Z'));
 assert.throws(()=>normalizePaperSnapshot(account,positions,[{...orders[0],status:4}],'2026-10-13T15:00:00Z'));
});
test('detects incomplete recent order pagination',()=>{
 const o=Array.from({length:25},(_,i)=>({...orders[0],id:'order-'+i}));
 const r=normalizePaperSnapshot(account,positions,o,'2026-10-13T15:00:00Z');
 assert.ok(r.warnings.includes('ORDER_HISTORY_LIMIT_REACHED'));
});
test('any failed upstream read rejects the whole snapshot',async()=>{
 const fail=async ()=>new Response('unauthorized',{status:401});
 await assert.rejects(getAlpacaPaperSnapshot(auth,fail));
 const invalid=async ()=>new Response('not-json',{status:200});
 await assert.rejects(getAlpacaPaperSnapshot(auth,invalid));
});
test('no order-write, live API or unsafe dynamic upstream URL path exists',()=>{
 const source=readFileSync(new URL('./alpaca-paper-reader.ts',import.meta.url),'utf8');
 const route=readFileSync(new URL('../../app/api/internal/alpaca-paper/route.ts',import.meta.url),'utf8');
 assert.ok(!source.includes('https://api.alpaca.markets'));
 assert.ok(!source.includes("method:'POST'"));
 assert.ok(!source.includes("method:'DELETE'"));
 assert.ok(!route.includes('NEXT_PUBLIC_ALPACA'));
 assert.ok(!route.includes("export const dynamic="));
 assert.ok(!route.includes("export async function POST"));
});
