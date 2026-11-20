import test from 'node:test';
import assert from 'node:assert/strict';
import {
 KXHIGHNY_CONTRACT_SPEC,strikeIntegerRange,settlesYes,validateStrikePartition,
 tradingFeeMicros,expectedValueMicros,breakevenProbabilityPpm,
} from './contract-math.ts';
import {provisionalTakerFeeMicros} from './paper.ts';

const cents=(c)=>c*10_000;

test('contract spec records the verified KXHIGHNY settlement facts',()=>{
 assert.equal(KXHIGHNY_CONTRACT_SPEC.series,'KXHIGHNY');
 assert.equal(KXHIGHNY_CONTRACT_SPEC.station,'KNYC_CENTRAL_PARK');
 assert.equal(KXHIGHNY_CONTRACT_SPEC.dayDefinition,'LOCAL_STANDARD_TIME_UTC_MINUS_5');
 assert.equal(KXHIGHNY_CONTRACT_SPEC.minimumTickMicros,10_000);
 assert.equal(KXHIGHNY_CONTRACT_SPEC.takerFeeMultiplier,1);
 assert.equal(KXHIGHNY_CONTRACT_SPEC.makerFeeMultiplier,0);
 assert.equal(Object.isFrozen(KXHIGHNY_CONTRACT_SPEC),true);
});

test('strike operators follow GLOBALTEMPERATURE terms for whole-degree reports',()=>{
 // "between" is inclusive; "above" is strictly greater; "below" strictly less; "at least" >=.
 assert.deepEqual(strikeIntegerRange({kind:'between',lowerF:59,upperF:60}),{minF:59,maxF:60});
 assert.deepEqual(strikeIntegerRange({kind:'above',thresholdF:66}),{minF:67,maxF:null});
 assert.deepEqual(strikeIntegerRange({kind:'below',thresholdF:59}),{minF:null,maxF:58});
 assert.deepEqual(strikeIntegerRange({kind:'at_least',thresholdF:67}),{minF:67,maxF:null});
 // Hitting the threshold exactly resolves NO for strict tails.
 assert.equal(settlesYes({kind:'above',thresholdF:66},66),false);
 assert.equal(settlesYes({kind:'above',thresholdF:66},67),true);
 assert.equal(settlesYes({kind:'below',thresholdF:59},59),false);
 assert.equal(settlesYes({kind:'below',thresholdF:59},58),true);
 assert.equal(settlesYes({kind:'between',lowerF:63,upperF:64},64),true);
 assert.equal(settlesYes({kind:'between',lowerF:63,upperF:64},65),false);
 // Fractional thresholds (e.g. a B88.5 midpoint written as 88.5 > x) still map to whole degrees.
 assert.deepEqual(strikeIntegerRange({kind:'above',thresholdF:88.5}),{minF:89,maxF:null});
 assert.deepEqual(strikeIntegerRange({kind:'below',thresholdF:88.5}),{minF:null,maxF:88});
});

test('invalid strikes and non-integer observations are refused',()=>{
 assert.throws(()=>strikeIntegerRange({kind:'between',lowerF:61,upperF:60}),/KALSHI_INVALID_STRIKE/);
 assert.throws(()=>strikeIntegerRange({kind:'between',lowerF:60.2,upperF:60.8}),/KALSHI_INVALID_STRIKE/);
 assert.throws(()=>strikeIntegerRange({kind:'above',thresholdF:Number.NaN}),/KALSHI_INVALID_STRIKE/);
 assert.throws(()=>strikeIntegerRange({kind:'exactly',thresholdF:60}),/KALSHI_INVALID_STRIKE/);
 assert.throws(()=>settlesYes({kind:'above',thresholdF:60},60.5),/KALSHI_INVALID_OBSERVATION/);
});

test('an event ladder must partition every whole degree exactly once',()=>{
 const ladder=[
  {kind:'below',thresholdF:59},{kind:'between',lowerF:59,upperF:60},{kind:'between',lowerF:61,upperF:62},
  {kind:'between',lowerF:63,upperF:64},{kind:'between',lowerF:65,upperF:66},{kind:'above',thresholdF:66},
 ];
 const ranges=validateStrikePartition([...ladder].reverse());
 assert.equal(ranges.length,6);
 assert.deepEqual(ranges[0],{minF:null,maxF:58});
 assert.deepEqual(ranges.at(-1),{minF:67,maxF:null});
 for(let t=30;t<=90;t++)assert.equal(ladder.filter(s=>settlesYes(s,t)).length,1,'temp '+t);
 assert.throws(()=>validateStrikePartition(ladder.slice(1)),/KALSHI_STRIKES_NOT_PARTITION/);
 assert.throws(()=>validateStrikePartition([...ladder.slice(0,2),...ladder.slice(3)]),/KALSHI_STRIKES_NOT_PARTITION/);
 assert.throws(()=>validateStrikePartition([...ladder,{kind:'between',lowerF:60,upperF:61}]),/KALSHI_STRIKES_NOT_PARTITION/);
});

test('cent-rounded taker fees reproduce every row of the published July 7 2026 table',()=>{
 // [price cents, fee for 1 contract cents, fee for 100 contracts cents]
 const table=[[1,1,7],[5,1,34],[10,1,63],[15,1,90],[20,2,112],[25,2,132],[30,2,147],[35,2,160],[40,2,168],
  [45,2,174],[50,2,175],[55,2,174],[60,2,168],[65,2,160],[70,2,147],[75,2,132],[80,2,112],[85,1,90],
  [90,1,63],[95,1,34],[99,1,7]];
 for(const [p,one,hundred] of table){
  assert.equal(tradingFeeMicros({priceMicros:cents(p),contracts:1,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),cents(one),'1@'+p);
  assert.equal(tradingFeeMicros({priceMicros:cents(p),contracts:100,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),cents(hundred),'100@'+p);
 }
});

test('centicent rounding matches the schedule text and the existing K0 provisional fee',()=>{
 for(const p of [1,7,33,50,61,99])for(const c of [1,2,3,5,17,100]){
  const text=tradingFeeMicros({priceMicros:cents(p),contracts:c,role:'taker',rounding:'SCHEDULE_TEXT_CENTICENT'});
  assert.equal(text,provisionalTakerFeeMicros(cents(p),c),`p=${p} c=${c}`);
  // The table rounding is never cheaper, so it is the conservative research default.
  assert.ok(tradingFeeMicros({priceMicros:cents(p),contracts:c,role:'taker',rounding:'SCHEDULE_TABLE_CENT'})>=text);
 }
 // 1 contract at 1 cent: 0.000693 dollars -> 0.0007 centicent-rounded, 0.01 cent-rounded.
 assert.equal(tradingFeeMicros({priceMicros:cents(1),contracts:1,role:'taker',rounding:'SCHEDULE_TEXT_CENTICENT'}),700);
});

test('maker fees are zero for KXHIGHNY and taker multipliers are explicit',()=>{
 assert.equal(tradingFeeMicros({priceMicros:cents(50),contracts:10,role:'maker',rounding:'SCHEDULE_TABLE_CENT'}),0);
 // A series with a maker multiplier of 1 pays 0.0175*C*P*(1-P): 10@50c = 0.04375 -> 0.05.
 assert.equal(tradingFeeMicros({priceMicros:cents(50),contracts:10,role:'maker',multiplier:1,rounding:'SCHEDULE_TABLE_CENT'}),cents(5));
 assert.equal(tradingFeeMicros({priceMicros:cents(50),contracts:10,role:'taker',multiplier:0,rounding:'SCHEDULE_TABLE_CENT'}),0);
});

test('fee inputs off the $0.01 tick or outside bounds are refused',()=>{
 assert.throws(()=>tradingFeeMicros({priceMicros:505_000,contracts:1,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),/KALSHI_PRICE_OFF_TICK/);
 assert.throws(()=>tradingFeeMicros({priceMicros:0,contracts:1,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),/KALSHI_INVALID_FEE_INPUT/);
 assert.throws(()=>tradingFeeMicros({priceMicros:cents(100),contracts:1,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),/KALSHI_INVALID_FEE_INPUT/);
 assert.throws(()=>tradingFeeMicros({priceMicros:cents(50),contracts:0,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),/KALSHI_INVALID_FEE_INPUT/);
 assert.throws(()=>tradingFeeMicros({priceMicros:cents(50),contracts:1,role:'taker',rounding:'GUESS'}),/KALSHI_INVALID_FEE_INPUT/);
});

test('expected value and breakeven are fee-inclusive integer microdollars',()=>{
 // Buy 1 YES at 40c, taker fee 2c, model 45% -> 0.45 - 0.40 - 0.02 = +0.03.
 const ev=expectedValueMicros({probabilityWinPpm:450_000,priceMicros:cents(40),contracts:1,
  role:'taker',rounding:'SCHEDULE_TABLE_CENT'});
 assert.deepEqual(ev,{feeMicros:cents(2),costMicros:cents(42),expectedPayoutMicros:450_000,expectedNetMicros:30_000});
 assert.equal(breakevenProbabilityPpm({priceMicros:cents(40),contracts:1,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),420_000);
 // At 100 contracts the cent rounding amortizes: fee $1.68 -> breakeven 41.68%.
 assert.equal(breakevenProbabilityPpm({priceMicros:cents(40),contracts:100,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),416_800);
 assert.throws(()=>expectedValueMicros({probabilityWinPpm:1_000_001,priceMicros:cents(40),contracts:1,role:'taker',rounding:'SCHEDULE_TABLE_CENT'}),/KALSHI_INVALID_PROBABILITY/);
});
