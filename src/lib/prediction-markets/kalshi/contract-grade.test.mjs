import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gradeContractResearch,verifyContractForecast} from './contract-grade.ts';
import {parseCentralParkCli} from './nws-cli.ts';
import {forecastFixture,clone} from '../../server/kalshi-platform-test-kit.mjs';
const report=['CDUS41 KOKX 220637','CLINYC','CLIMATE REPORT','NATIONAL WEATHER SERVICE NEW YORK, NY',
 '137 AM EST SUN NOV 22 2026','...THE CENTRAL PARK NY CLIMATE SUMMARY FOR NOVEMBER 21 2026...',
 'CLIMATE NORMAL PERIOD 1991 TO 2020','TEMPERATURE (F)',' YESTERDAY','   MAXIMUM         61   1211 AM  73  1931','$$'].join('\n');
const cli=()=>parseCentralParkCli(report,'2026-11-22T08:00:00Z');
test('independent preliminary grades measure temperature but cannot invent probabilities, settlement or profit',()=>{
 const g=gradeContractResearch(forecastFixture(),cli(),'2026-11-22T09:00:00Z');
 assert.equal(g.absoluteErrorF,1);assert.equal(g.brier,null);assert.equal(g.logLoss,null);
 assert.equal(g.profitMicros,null);assert.equal(g.exchangeSettlement,false);assert.equal(g.source,'NWS_PRELIMINARY_RESEARCH');
 assert.equal(g.contractResults.filter(Boolean).length,1);
});
test('a trained synthetic distribution receives finite scores without becoming a proven or monetary result',()=>{
 const g=gradeContractResearch(forecastFixture(35),cli(),'2026-11-22T09:00:00Z');
 assert.ok(g.brier>0&&g.brier<1);assert.ok(Number.isFinite(g.logLoss));assert.equal(g.profitMicros,null);
});
test('grade source publication must precede the recorded grading time and match the target day',()=>{
 assert.throws(()=>gradeContractResearch(forecastFixture(),cli(),'2026-11-22T07:59:59Z'),/GRADE_TIME/);
 const wrong=parseCentralParkCli(report.replace('NOVEMBER 21','NOVEMBER 20').replace('SUN NOV 22','SAT NOV 21').replace('220637','210637'),'2026-11-21T08:00:00Z');
 assert.throws(()=>gradeContractResearch(forecastFixture(),wrong,'2026-11-22T09:00:00Z'),/GRADE_TIME/);
});
test('frozen forecast hashes, status and probability bounds are verified when records are reloaded',()=>{
 const f=forecastFixture();assert.deepEqual(verifyContractForecast(JSON.parse(JSON.stringify(f))),f);
 const changed=clone(f);changed.input.forecastHighF=99;assert.throws(()=>verifyContractForecast(changed),/FORECAST_INVALID/);
 const trained=clone(forecastFixture(35));trained.contracts[0].probabilityYesPpm=-1;
 const {id:unused,...base}=trained;void unused;trained.id=createHash('sha256').update(JSON.stringify(base)).digest('hex');
 assert.throws(()=>verifyContractForecast(trained),/FORECAST_INVALID/);
});
