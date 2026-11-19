import test from 'node:test';
import assert from 'node:assert/strict';
import {KALSHI_API,moneyMicros,normalizeBook,normalizeMarket,listWeatherMarkets,getWeatherOrderbook} from './client.ts';
const at='2026-11-13T20:00:00.000Z',ticker='KXHIGHNY-26NOV13-T55';
const market={ticker,event_ticker:'KXHIGHNY-26NOV13',market_type:'binary',title:'NYC high temperature?',
 status:'open',close_time:'2026-11-14T00:00:00Z',updated_time:'2026-11-13T19:00:00Z',rules_primary:'Final NWS source'};
const book={orderbook_fp:{yes_dollars:[['0.3100','2.00'],['0.4200','13.00']],no_dollars:[['0.5600','17.00'],['0.4400','1.00']]}};
const fetchMock=(data,assertRequest=()=>{})=>async(url,init)=>{
 assertRequest(url,init);return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
};
test('fixed-point money has no floating-point cent rounding',()=>{
 assert.equal(moneyMicros('0.4200'),420000);assert.equal(moneyMicros('0.000001'),1);
 assert.throws(()=>moneyMicros('0.1234567'),/PRICE/);assert.throws(()=>moneyMicros('1.2'),/PRICE/);
 assert.throws(()=>moneyMicros(0.42),/PRICE/);
});
test('market snapshot preserves as-of and resolution rule, excludes displayed last price',()=>{
 const m=normalizeMarket({...market,last_price_dollars:'0.9900'},'KXHIGHNY',at);
 assert.equal(m.closeTime,'2026-11-14T00:00:00Z');
 assert.equal(m.rulesPrimary,'Final NWS source');
 assert.equal('lastPrice' in m,false);
 assert.throws(()=>normalizeMarket({...market,market_type:'scalar'},'KXHIGHNY',at),/NOT_ALLOWED/);
 assert.throws(()=>normalizeMarket({...market,ticker:'KXSPORT-1'},'KXHIGHNY',at),/NOT_ALLOWED/);
});
test('YES buy ask is 1 minus highest NO bid (not a displayed bid or midpoint)',()=>{
 const x=normalizeBook(ticker,book,at);
 assert.equal(x.yesBestBidMicros,420000);assert.equal(x.noBestBidMicros,560000);
 assert.equal(x.buyYesAskMicros,440000);assert.equal(x.buyNoAskMicros,580000);
 assert.equal(x.buyYesAvailableSizeMicros,17_000_000);assert.equal(x.buyNoAvailableSizeMicros,13_000_000);
});
test('empty book has no invented executable quotes',()=>{
 const x=normalizeBook(ticker,{orderbook_fp:{yes_dollars:[],no_dollars:[]}},at);
 assert.equal(x.buyYesAskMicros,null);assert.equal(x.buyNoAskMicros,null);
 assert.throws(()=>normalizeBook(ticker,{orderbook_fp:{yes_dollars:[['1.1','3.00']],no_dollars:[]}},at),/PRICE/);
 assert.throws(()=>normalizeBook(ticker,{orderbook_fp:{yes_dollars:[['0.4','0.00']],no_dollars:[]}},at),/COUNT/);
});
test('list: one bounded public GET with no auth, credentials, write or redirect',async()=>{
 let calls=0;
 const result=await listWeatherMarkets(fetchMock({markets:[market]},(url,init)=>{
  calls++;assert.equal(url,KALSHI_API+'/markets?series_ticker=KXHIGHNY&status=open&limit=30');
  assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');
  assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,undefined);
 }),()=>at);
 assert.equal(calls,1);assert.equal(result.length,1);assert.equal(result[0].fetchedAt,at);
});
test('orderbook rejects malformed/sport/untrusted tickers before contacting provider',async()=>{
 let calls=0;
 const f=fetchMock(book,()=>{calls++;});
 await assert.rejects(getWeatherOrderbook('https://evil.example/',f),/NOT_ALLOWED/);
 await assert.rejects(getWeatherOrderbook('KXNBAGAME-1',f),/NOT_ALLOWED/);
 await assert.rejects(getWeatherOrderbook('KXHIGHNY-1%2Forders',f),/NOT_ALLOWED/);
 assert.equal(calls,0);
 const x=await getWeatherOrderbook(ticker,f,()=>at);assert.equal(calls,1);assert.equal(x.buyYesAskMicros,440000);
});
test('429, non-JSON and missing payload fail closed without a retry',async()=>{
 let calls=0;
 const f=async()=>{calls++;return new Response('',{status:429,headers:{'content-type':'application/json'}});};
 await assert.rejects(listWeatherMarkets(f),/RATE_LIMITED/);assert.equal(calls,1);
 await assert.rejects(listWeatherMarkets(async()=>new Response('hello',{headers:{'content-type':'text/plain'}})),/NOT_JSON/);
 await assert.rejects(listWeatherMarkets(fetchMock({foo:[]})),/INVALID_MARKETS/);
});
test('oversized response refuses to parse or store',async()=>{
 const f=async()=>new Response(JSON.stringify({markets:[],padding:'x'.repeat(210_000)}),{headers:{'content-type':'application/json'}});
 await assert.rejects(listWeatherMarkets(f),/TOO_LARGE/);
});
