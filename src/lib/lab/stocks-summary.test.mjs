// Stock lab summary: parsed on its own, validated vs unvalidated kept apart. Synthetic TEST-ONLY values.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLab} from '../research/stock-summary.ts';
import {stockLabSummary} from './stocks-summary.ts';
import {labAnswer} from '../assistant/lab-answer.ts';
import {loadLabFrom} from '../server/lab-load-core.ts';
import {readFileSync} from 'node:fs';
const read=f=>JSON.parse(readFileSync(new URL('../../../research/'+f,import.meta.url),'utf8'));

const LAB={experiment:'lab-stock-psychology-v1',historicalAt:'2026-11-14T02:30:00Z',layers:['market_regime','attention_spike','volatility_shock','short_term_overreaction'],
 unsupported:['news_sentiment','earnings_surprise','search_attention','crowd_concentration'],
 verdicts:{market_regime:'no_clear_effect',attention_spike:'helps',volatility_shock:'hurts',short_term_overreaction:'no_clear_effect',news_sentiment:'not_tested: No feed.'},
 holdout:{base:{cagr:0.08,sharpe:0.7,max_drawdown:-0.12,total:0.3,exposure:0.45},combined:{cagr:0.07,sharpe:0.75,max_drawdown:-0.09,total:0.25,exposure:0.4}},
 forward:{frozenRows:10,firstDecision:'2026-11-16',minWeeks:26,variants:{base:{weeks:0,pending:1,total_return:null,status:'collecting',latest_session:'2026-11-16'}}},
 validated:[],unvalidated:[{layer:'attention_spike',historical:'helps'},{layer:'market_regime',historical:'no_clear_effect'}]};

test('a valid lab section parses; a malformed one is dropped, not guessed',()=>{
 assert.deepEqual(parseLab(LAB),LAB);
 assert.equal(parseLab({...LAB,holdout:{base:{cagr:'big'}}}),null);
 assert.equal(parseLab({...LAB,forward:{...LAB.forward,frozenRows:-1.5}}),null);
 assert.equal(parseLab(null),null);
});
test('a historical "helps" stays unvalidated until the forward ledger reaches its minimum; chat says so',async()=>{
 const s=stockLabSummary({summary:{lab:LAB},mode:'live',checkedAt:'2026-11-14T03:00:00Z'});
 assert.equal(s.state,'ready');
 assert.match(s.summary,/Validated findings: none/);assert.match(s.summary,/Attention spikes \(helps\)/);assert.match(s.summary,/0 graded week\(s\) of 26/);
 assert.equal(stockLabSummary(null).state,'not_run');
 const view=await loadLabFrom(null,'2026-11-14T03:00:00Z',read('lab_sports_ablation_20261112/report.json'),read('lab_staking_20261112/report.json'),s);
 const r=labAnswer('Did psychology improve our stock predictions?',view,null,'2026-11-14T03:00:00Z');
 assert.match(r.text,/Validated findings: none/);assert.match(r.text,/Monday supervised PAPER release are unchanged/);
 assert.ok(r.cards.some(c=>c.kind==='table'));
});
test('verdict badges stay short; the reason a layer is not tested is separate text (it wraps on phones)',()=>{
 const s=stockLabSummary({summary:{lab:{...LAB,verdicts:{...LAB.verdicts,earnings_surprise:'not_tested: No point-in-time earnings estimates and announcement times are collected.'}}},mode:'live',checkedAt:'2026-11-14T03:00:00Z'});
 const by=Object.fromEntries(s.verdicts.map(v=>[v.layer,v]));
 assert.deepEqual([by['Earnings surprises'].verdict,by['Earnings surprises'].label],['not_tested','Not tested']);
 assert.match(by['Earnings surprises'].detail,/point-in-time earnings/);
 assert.deepEqual([by['Market regime (SPY vs 200-day)'].label,by['Market regime (SPY vs 200-day)'].detail],['No clear effect',null]);
 assert.equal(by['Search attention'].label,'Not run yet');
 for(const v of s.verdicts)assert.ok(v.label.length<=16,v.label);
});
