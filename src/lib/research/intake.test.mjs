import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessIntake,credibility,hypothesisKey} from './intake.ts';

const registry=JSON.parse(readFileSync(new URL('../../../config/research/registry.json',import.meta.url),'utf8'));
const src=(over={})=>({url:'https://www.sec.gov/example',kind:'primary-filing',retrievedAt:'2026-11-12T20:00:00Z',author:null,sellsProduct:false,performanceVerifiable:true,...over});
const card=(over={})=>({domain:'stocks',title:'Example',rule:'Hold the top 5 13F positions, rebalanced 46 days after quarter end',
 inputs:[{name:'13F holdings',availableBeforeDecision:true,freeSource:'SEC EDGAR'},{name:'daily close',availableBeforeDecision:true,freeSource:'Alpaca IEX'}],
 holdingPeriod:'quarter',baseline:'exposure-matched SPY',costsModel:'10 and 25 bps per side',sources:[src()],
 biases:{survivorship:'point-in-time filings',selection:'fixed manager chosen before results',disclosureDelay:'45-day filing lag applied',transactionCosts:'10/25 bps',dataSnooping:'one pre-registered rule'},...over});

test('the live registry parses with the shape intake reads', () => {
  assert.ok(Array.isArray(registry.strategies) && registry.strategies.length > 0);
  for (const s of registry.strategies) assert.equal(typeof s.id, 'string');
});

test('complete, leak-free, free-data cards are ready to pre-register; titles never change the duplicate key', () => {
  const v = assessIntake(card(), registry);
  assert.equal(v.status, 'READY_TO_PREREGISTER', v.reasons.join(' '));
  assert.equal(hypothesisKey(card({title: 'Different words'})), v.key);
  assert.equal(hypothesisKey(card({inputs: [...card().inputs].reverse()})), v.key);
  assert.equal(assessIntake(card(), registry, new Set([v.key])).status, 'DUPLICATE');
});

test('a rule already registered as rejected is not researched again', () => {
  const key = hypothesisKey(card());
  const r = {strategies: [{id: 'old-idea', status: 'rejected', intakeKey: key}]};
  const v = assessIntake(card(), r);
  assert.equal(v.status, 'PREVIOUSLY_REJECTED');
  assert.match(v.reasons[0], /old-idea/);
});

test('look-ahead inputs, paid-only data and missing bias reviews are refused', () => {
  assert.equal(assessIntake(card({inputs: [{name: 'final box score', availableBeforeDecision: false, freeSource: 'ESPN'}]}), registry).status, 'NOT_TESTABLE');
  assert.match(assessIntake(card({inputs: [{name: 'consolidated quotes', availableBeforeDecision: true, freeSource: null}]}), registry).reasons.join(' '), /owner approval/);
  assert.equal(assessIntake(card({biases: {...card().biases, survivorship: ''}}), registry).status, 'INCOMPLETE');
  assert.equal(assessIntake(card({sources: [src({url: 'http://insecure.example'})]}), registry).status, 'INCOMPLETE');
});

test('credibility: unverifiable or conflicted claims score low; primary filings score high', () => {
  assert.equal(credibility([src()]), 1);
  assert.equal(credibility([src({kind: 'self-reported-claim', performanceVerifiable: false, sellsProduct: true})]), 0.1);
  assert.equal(credibility([src({kind: 'peer-reviewed', performanceVerifiable: false})]), 0.3);
  assert.equal(credibility([src({kind: 'marketing'}), src({kind: 'working-paper'})]), 0.6);
  assert.equal(credibility([]), 0);
  const tout = assessIntake(card({sources: [src({kind: 'social-media', sellsProduct: true, performanceVerifiable: false})]}), registry);
  assert.match(tout.reasons[0], /claim itself is not evidence/);
});
