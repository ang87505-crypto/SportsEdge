import test from 'node:test';
import assert from 'node:assert/strict';
import {SECTIONS,activeChild,crumbsFor,parentFor,sectionFor} from './navigation.ts';

test('the PrizePicks dashboard is the betting section landing page, not a moneyline child',()=>{
 assert.equal(sectionFor('/paper-betting/props').id,'paper');
 assert.deepEqual(crumbsFor('/paper-betting/props'),[{href:'/paper-betting/props',label:'PrizePicks'}]);
 assert.equal(parentFor('/paper-betting/props'),null);
});
test('child pages resolve to the longest matching child',()=>{
 assert.deepEqual(crumbsFor('/paper-betting').map(c=>c.href),['/paper-betting/props','/paper-betting']);
 assert.deepEqual(crumbsFor('/paper-betting/props-research').map(c=>c.href),['/paper-betting/props','/paper-betting/props-research']);
 assert.equal(parentFor('/paper-betting/props-research').href,'/paper-betting/props');
 const paper=SECTIONS.find(s=>s.id==='paper');
 assert.equal(activeChild(paper,'/paper-betting/props?platform=pick6'.split('?')[0]),null);
});
test('other sections are unchanged',()=>{
 assert.deepEqual(crumbsFor('/stocks/paper-auto').map(c=>c.href),['/stocks','/stocks/paper-auto']);
 assert.deepEqual(crumbsFor('/research/nba').map(c=>c.href),['/sports','/research/nba']);
 assert.deepEqual(crumbsFor('/automation').map(c=>c.href),['/automation']);
});

test('the Ask page sits under PrizePicks',()=>{
 assert.deepEqual(crumbsFor('/assistant').map(c=>c.href),['/paper-betting/props','/assistant']);
 assert.ok(SECTIONS.find(s=>s.id==='paper').children.some(c=>c.href==='/assistant'&&c.label==='Ask'));
});
