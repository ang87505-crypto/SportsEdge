/** Offline synthetic replay only; no account, API key or network is needed. */
import {openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {normalizeMarket,normalizeBook} from '../src/lib/prediction-markets/kalshi/client.ts';
import {createPaperLedger,setPaperLedgerPaused,recordPaperForecast,recordPaperSettlement,
 replayPaperLedger} from '../src/lib/prediction-markets/kalshi/paper-ledger.ts';

const args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--output'||!args[1]))
 throw Error('Usage: node --experimental-strip-types scripts/kalshi-paper-replay.ts [--output NEW_FILE]');
const quote='2026-11-20T20:00:00Z',ticker='KXHIGHNY-26NOV20-T55';
let journal=createPaperLedger({id:'synthetic-weather-account',mode:'OFFLINE_FIXTURE',
 initialBalanceMicros:10_000_000,maxPositionCostMicros:5_000_000,
 maxOpenCostMicros:10_000_000,maxOpenPositions:5},'2026-11-20T12:00:00Z');
journal=setPaperLedgerPaused(journal,'fixture-start',false,'Synthetic development replay','2026-11-20T12:00:01Z');
const market=normalizeMarket({ticker,event_ticker:'KXHIGHNY-26NOV20',market_type:'binary',
 title:'SYNTHETIC NYC temperature',status:'active',rules_primary:'Synthetic final station rule',
 rules_secondary:'Synthetic whole-degree boundary',close_time:'2026-11-21T01:00:00Z',updated_time:quote},'KXHIGHNY',quote);
const book=normalizeBook(ticker,{orderbook_fp:{yes_dollars:[['0.4100','10.00']],
 no_dollars:[['0.5600','5.00']]}},quote);
journal=recordPaperForecast(journal,'fixture-forecast',{market,book,modelId:'synthetic-weather-fixture',
 modelDataAsOf:'2026-11-20T19:00:00Z',modelDataDigest:'a'.repeat(64),probabilityYesPpm:700000,
 maxContracts:2,slippageMicrosPerContract:5000,minEdgeMicrosPerContract:10000},'2026-11-20T20:00:15Z');
const open=replayPaperLedger(journal),forecast=open.positions[0].forecast;
const official={marketTicker:forecast.marketTicker,eventTicker:forecast.eventTicker,status:'settled',result:'yes' as const,
 rulesPrimary:forecast.rulesPrimary,rulesSecondary:forecast.rulesSecondary,settledAt:'2026-11-21T03:00:00Z',
 fetchedAt:'2026-11-21T04:00:00Z',sourceDigest:'b'.repeat(64),source:'kalshi-public-market-get' as const};
journal=recordPaperSettlement(journal,'fixture-grade',forecast.id,official,'2026-11-21T04:00:01Z');
const settled=replayPaperLedger(journal);
journal=recordPaperSettlement(journal,'fixture-correction',forecast.id,{...official,result:'no',
 fetchedAt:'2026-11-22T04:00:00Z',sourceDigest:'c'.repeat(64)},'2026-11-22T04:00:01Z');
const corrected=replayPaperLedger(journal);
const output={kind:'SYNTHETIC_OFFLINE_REPLAY',networkRequests:0,
 warning:corrected.warning,journal,stages:{open,settled,corrected}};
const encoded=JSON.stringify(output,null,2)+'\n';
if(args.length){
 // Exclusive creation: never replace an existing result, ledger or user's file.
 const file=openSync(args[1],'wx',0o600);
 try{writeFileSync(file,encoded,'utf8');fsyncSync(file);}finally{closeSync(file);}
}
process.stdout.write(encoded);
