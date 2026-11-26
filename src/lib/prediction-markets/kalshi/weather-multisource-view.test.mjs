// Dashboard view of the multi-source weather challenger. SYNTHETIC scorecards; the 2024 rows come from the committed file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {HISTORICAL_2024,verifyShadowCard,loadMultisourceShadow} from './weather-multisource-view.ts';

const card=()=>({schema:'kalshi-weather-multisource-paper-scorecard-v1',at:'2026-11-29T09:14:00.000Z',
 summary:['DAY_AHEAD','SAME_DAY'].map(anchor=>({anchor,frozen:2,graded:1,ungraded:1,missedSince:[],meanCrps:{COMBINED:1.1,NBM_CORRECTED:1.2},
  disposition:'NO_CLEAR_EFFECT',reason:'1/50 graded forward days.'})),
 readiness:{paperForecasting:{status:'READY',missing:[]},ownerReview:{status:'NOT_READY',missing:['DAY_AHEAD: 1/50 graded forward days']},exchange:'DISABLED'}});

test('the committed 2024 evaluation is shown as recorded, including the NBM comparisons and the verdict',()=>{
 assert.equal(HISTORICAL_2024.disposition,'NO_CLEAR_EFFECT');
 const da=HISTORICAL_2024.rows.find(r=>r.anchor==='DAY_AHEAD');
 assert.equal(da.holdoutDays,166);assert.ok(da.crps.combined<da.crps.nbmCorrected);
 assert.ok(da.vsNbmCorrected.lower95<0&&da.vsNbmCorrected.upper95>0,'the interval includes zero: not established');
});
test('the shadow scorecard is validated whole; malformed or exchange-enabled cards are refused',()=>{
 const v=verifyShadowCard(card());assert.equal(v.anchors.length,2);assert.equal(v.exchange,'DISABLED');assert.equal(v.ownerReview.status,'NOT_READY');
 for(const bad of [{...card(),schema:'x'},{...card(),readiness:{...card().readiness,exchange:'ENABLED'}},{...card(),summary:[card().summary[0]]},
  {...card(),summary:card().summary.map(s=>({...s,graded:-1}))}])assert.throws(()=>verifyShadowCard(bad),/WX_MS_VIEW_INVALID/);
});
test('loader: newest scorecard by name; empty or failing archive is reported, never guessed',async()=>{
 const res=(status,body)=>({ok:status===200,status,json:async()=>body,text:async()=>JSON.stringify(body)});
 const seen=[];const f=async url=>{seen.push(url);if(url.includes('api.github.com'))return res(200,[{name:'2026-11-28T0915Z.json',type:'file'},
  {name:'2026-11-29T0914Z.json',type:'file'},{name:'evil.json',type:'file'}]);return res(200,card());};
 const r=await loadMultisourceShadow(f);assert.equal(r.state,'RECORDED');assert.match(seen[1],/2026-11-29T0914Z\.json$/);
 assert.equal((await loadMultisourceShadow(async()=>res(404,{}))).state,'AWAITING_FIRST_FORECAST');
 assert.equal((await loadMultisourceShadow(async()=>res(500,{}))).state,'ARCHIVE_UNAVAILABLE');
 assert.equal((await loadMultisourceShadow(async url=>url.includes('api.github')?res(200,[{name:'2026-11-29T0914Z.json',type:'file'}]):res(200,{schema:'x'}))).state,'ARCHIVE_UNAVAILABLE');
});
