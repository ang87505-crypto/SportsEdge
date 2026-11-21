import test from 'node:test';
import assert from 'node:assert/strict';
import {periodKind,parseCompanyFactsV2,asOfKind,restatementReport,durationAmbiguity,identityCheck} from './sec-pit-v2.ts';
import {parseCompanyFacts,asOf} from './sec-companyfacts.ts';

// Synthetic companyfacts in the SEC's shape. A 10-Q reports the quarter AND year-to-date with the same `end`.
const row=(start,end,val,accn,form,filed,frame)=>({...(start?{start}:{}),end,val,accn,fy:2025,fp:'Q',form,filed,...(frame?{frame}:{})});
const body={cik:123,facts:{'us-gaap':{
 Revenues:{units:{USD:[
  row('2024-10-01','2024-12-31',100,'0000000123-25-000001','10-Q','2025-02-05','CY2024Q4'),
  row('2024-01-01','2024-12-31',380,'0000000123-25-000002','10-K','2025-02-20','CY2024'),
  row('2025-01-01','2025-03-31',110,'0000000123-25-000003','10-Q','2025-05-02','CY2025Q1'),
  row('2025-04-01','2025-06-30',120,'0000000123-25-000004','10-Q','2025-08-01','CY2025Q2'),
  row('2025-01-01','2025-06-30',230,'0000000123-25-000004','10-Q','2025-08-01'),
  row('2025-07-01','2025-09-30',130,'0000000123-25-000005','10-Q','2025-11-03','CY2025Q3'),
  row('2025-01-01','2025-09-30',360,'0000000123-25-000005','10-Q','2025-11-03'),
  // The next 10-Q repeats Q2 unchanged (comparative) and restates Q3 from 130 to 128.
  row('2025-04-01','2025-06-30',120,'0000000123-26-000006','10-Q','2026-02-04'),
  row('2025-07-01','2025-09-30',128,'0000000123-26-000006','10-Q','2026-02-04'),
 ]}},
 Assets:{units:{USD:[row(null,'2025-06-30',5000,'0000000123-25-000004','10-Q','2025-08-01'),
  row(null,'2025-09-30',5100,'0000000123-25-000005','10-Q','2025-11-03')]}},
 Junk:{units:{USD:[{end:'2025-01-01',val:'x',accn:'bad',form:'8-K',filed:'2025-01-02'}]}},
}}};

test('period kinds: instant, quarter, annual, other',()=>{
 assert.deepEqual(periodKind(null,'2025-06-30'),{kind:'instant',days:null});
 assert.equal(periodKind('2025-04-01','2025-06-30').kind,'quarter');
 assert.equal(periodKind('2024-01-01','2024-12-31').kind,'annual');
 assert.equal(periodKind('2025-01-01','2025-06-30').kind,'other','a 6-month year-to-date value is not a quarter');
});

test('v2 keeps start and drops malformed rows',()=>{
 const {facts,dropped}=parseCompanyFactsV2(body);
 assert.equal(dropped,1);
 assert.equal(facts.filter(f=>f.tag==='Revenues').length,9);
 assert.ok(facts.every(f=>f.cik==='0000000123'));
 assert.deepEqual(parseCompanyFactsV2({}),{facts:[],dropped:0});
});

test('as-of lookup by kind is point-in-time and never mixes durations',()=>{
 const {facts}=parseCompanyFactsV2(body);
 assert.equal(asOfKind(facts,'Revenues','quarter','2025-11-03').value,120,'Q3 filed 2025-11-03 is not usable that day');
 assert.equal(asOfKind(facts,'Revenues','quarter','2025-11-04').value,130);
 assert.equal(asOfKind(facts,'Revenues','quarter','2026-02-05').value,128,'the restatement counts only after it was filed');
 assert.equal(asOfKind(facts,'Revenues','annual','2025-11-04').value,380);
 assert.equal(asOfKind(facts,'Revenues','annual','2025-02-20'),null);
 assert.equal(asOfKind(facts,'Assets','instant','2025-11-04').value,5100);
});

test('v1 duration-blind lookup can return a year-to-date value where v2 returns the quarter',()=>{
 const v1=parseCompanyFacts(body).facts;
 const blind=asOf(v1,'Revenues','2025-11-04');
 assert.equal(blind.periodEnd,'2025-09-30');
 assert.ok([130,360].includes(blind.value),'v1 cannot tell the 3-month 130 from the 9-month 360');
 const {facts}=parseCompanyFactsV2(body);
 const amb=durationAmbiguity(facts,['Revenues'],['2025-08-02','2025-11-04','2026-02-05']);
 assert.equal(amb.checked,3);
 assert.equal(amb.endsWithSeveralDurations,3,'every 10-Q end carries a quarter and a year-to-date value');
});

test('restatements are separated from repeated comparatives',()=>{
 const {facts}=parseCompanyFactsV2(body);
 const r=restatementReport(facts.filter(f=>f.tag==='Revenues'));
 assert.equal(r.repeatedSameValue,1,'Q2 repeated unchanged');
 assert.equal(r.trueRestatements,1,'Q3 changed from 130 to 128');
 assert.deepEqual(r.examples[0],{tag:'Revenues',start:'2025-07-01',periodEnd:'2025-09-30',first:130,latest:128,restatedOn:'2026-02-04'});
});

test('identity check flags a CIK whose history starts after the research window',()=>{
 const {facts}=parseCompanyFactsV2(body);
 const late=identityCheck(facts,'2017-01-01');
 assert.equal(late.usable,false);
 assert.deepEqual(late.flags,['HISTORY_STARTS_AFTER_WINDOW','FEW_FACTS']);
 assert.deepEqual(identityCheck([], '2017-01-01').flags,['NO_FACTS']);
 assert.equal(identityCheck(facts,'2025-03-01',5).usable,true);
});
