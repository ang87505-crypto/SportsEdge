import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {predictLine,nbPmf,lineProbabilities} from './model.ts';
import {matchPlayer,playerKey,teamAbbr} from './identity.ts';
import {parseSummary,parseScoreboard} from './boxscore.ts';
import {gradeLine,decidePick,buildEntries,settleEntry,legResult} from './rules.ts';

const artifact=JSON.parse(readFileSync(new URL('../../data/props/model_v1.json',import.meta.url),'utf8'));
const P=artifact.params;
const day=(d,mins=32,pts=20,reb=6,ast=4)=>({gameStart:`2026-11-${String(d).padStart(2,'0')}T00:00:00Z`,minutes:mins,didNotPlay:false,points:pts,rebounds:reb,assists:ast});

test('frozen artifact carries version, source hash and fitted parameters',()=>{
 assert.equal(artifact.modelVersion,'props-nb-minutes-rate-v1');
 assert.match(artifact.source.sha256,/^[a-f0-9]{64}$/);
 for(const s of ['points','rebounds','assists'])assert.ok(P.dispersion[s]>0&&P.leagueRate[s]>0);
});

test('NB pmf sums to one and Poisson limit holds',()=>{
 let t=0;for(let n=0;n<200;n++)t+=nbPmf(n,22.4,8.5);
 assert.ok(Math.abs(t-1)<1e-9);
 assert.ok(Math.abs(nbPmf(3,2,Infinity)-Math.exp(-2)*8/6)<1e-12);
 const p=lineProbabilities(20,20,8);
 assert.ok(p.pTie>0&&Math.abs(p.pMore+p.pLess+p.pTie-1)<1e-12);
 assert.equal(lineProbabilities(19.5,20,8).pTie,0);
});

test('uses only games strictly before the cutoff (no future leakage)',()=>{
 const logs=[day(1),day(2),day(3),day(4)];
 const base=predictLine({logs,prior:null,stat:'points',line:19.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 // Adding a huge game AT or AFTER the cutoff must not change anything.
 const leaky=predictLine({logs:[...logs,day(5,48,70,20,20),day(6,48,70,20,20)],prior:null,stat:'points',line:19.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 assert.deepEqual(leaky,base);
 assert.equal(base.status,'scored');
 assert.ok(Math.abs(base.pMore+base.pLess+base.pTie-1)<1e-8);
});

test('sparse, stale or missing history is unscorable; DNPs and missing minutes are not zeros',()=>{
 const two=predictLine({logs:[day(1),day(2)],prior:null,stat:'points',line:10.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 assert.equal(two.reason,'insufficient_history');
 const dnp={gameStart:'2026-11-03T00:00:00Z',minutes:null,didNotPlay:true,points:null,rebounds:null,assists:null};
 const withDnp=predictLine({logs:[day(1),day(2),dnp],prior:null,stat:'points',line:10.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 assert.equal(withDnp.reason,'insufficient_history');
 const stale=predictLine({logs:[day(1),day(2),day(3)],prior:null,stat:'points',line:10.5,cutoff:'2026-11-29T00:00:00Z',params:P});
 assert.equal(stale.reason,'stale_history');
 const missing=predictLine({logs:[day(1),day(2),{...day(3),assists:null}],prior:null,stat:'assists',line:3.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 assert.equal(missing.reason,'missing_stat');
});

test('changing playing time moves the mean and widens uncertainty; outlier exits are excluded',()=>{
 const steady=predictLine({logs:[day(1),day(2),day(3),day(4)],prior:null,stat:'points',line:19.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 const cut=predictLine({logs:[day(1),day(2),day(3,16,10),day(4,16,10)],prior:null,stat:'points',line:19.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 assert.ok(cut.mean<steady.mean);
 assert.ok(cut.inputs.sdMinutes>steady.inputs.sdMinutes);
 const exit=predictLine({logs:[day(1),day(2),day(3),day(4,3,0)],prior:null,stat:'points',line:19.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 assert.equal(exit.inputs.games,3);
});

test('prior season shrinks small samples toward the player, else the league',()=>{
 const logs=[day(1,30,40),day(2,30,40),day(3,30,40)];
 const own=predictLine({logs,prior:{games:70,minutes:2100,points:700,rebounds:200,assists:100},stat:'points',line:25.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 const league=predictLine({logs,prior:null,stat:'points',line:25.5,cutoff:'2026-11-05T00:00:00Z',params:P});
 assert.equal(own.inputs.priorSource,'player');assert.equal(league.inputs.priorSource,'league');
 assert.ok(own.mean<40&&league.mean<40);
});

test('identity matching is strict about teams and ambiguity',()=>{
 assert.equal(playerKey('Luka Dončić'),playerKey('Luka Doncic'));
 assert.equal(playerKey("Jaren Jackson Jr."),playerKey('Jaren Jackson'));
 assert.equal(teamAbbr('Los Angeles Clippers'),'LAC');
 const c=[{athleteId:'1',name:'Test Player',teamAbbr:'BOS',lastGame:'x'},{athleteId:'2',name:'Twin Name',teamAbbr:'NY',lastGame:'x'},
  {athleteId:'3',name:'Twin Name',teamAbbr:'BOS',lastGame:'x'}];
 assert.deepEqual(matchPlayer('Test Player',['Boston Celtics','Miami Heat'],c),{status:'matched',athleteId:'1',teamAbbr:'BOS'});
 assert.equal(matchPlayer('Test Player',['Miami Heat','Utah Jazz'],c).reason,'player_not_found');
 assert.equal(matchPlayer('Twin Name',['Boston Celtics','New York Knicks'],c).reason,'ambiguous_player');
 assert.equal(matchPlayer('Test Player',['Boston Celtics','Seattle Test'],c).reason,'unknown_team');
});

// Synthetic ESPN-shaped fixture (TEST-ONLY ids), mirroring fields verified on a real summary.
const summary=(status='STATUS_FINAL',completed=true)=>({
 header:{id:'401999001',competitions:[{id:'401999001',date:'2026-11-08T00:00Z',status:{type:{name:status,completed,state:completed?'post':'pre'}},
  competitors:[{homeAway:'home',team:{abbreviation:'BOS'}},{homeAway:'away',team:{abbreviation:'NY'}}]}]},
 boxscore:{players:[{team:{abbreviation:'BOS'},statistics:[{keys:['minutes','points','fieldGoalsMade-fieldGoalsAttempted','rebounds','assists'],
  athletes:[{athlete:{id:'11',displayName:'Test Starter'},didNotPlay:false,stats:['36','27','10-18','7','5']},
   {athlete:{id:'12',displayName:'Test Bench'},didNotPlay:true,reason:"COACH'S DECISION",stats:[]},
   {athlete:{id:'13',displayName:'Broken Row'},didNotPlay:false,stats:['12','--','1-3','2','1']}]}]},
  {team:{abbreviation:'NY'},statistics:[{keys:['minutes','points','rebounds','assists'],athletes:[{athlete:{id:'21',displayName:'Test Guest'},didNotPlay:false,stats:['30','18','4','9']}]}]}]}});

test('box-score parser keeps DNPs, rejects incomplete rows and non-final games',()=>{
 const r=parseSummary(summary(),'401999001');
 assert.equal(r.status,'final');assert.equal(r.rejectedRows,1);
 assert.deepEqual(r.players.map(p=>[p.athleteId,p.didNotPlay,p.points,p.rebounds,p.assists]),
  [['11',false,27,7,5],['12',true,null,null,null],['21',false,18,4,9]]);
 assert.equal(parseSummary(summary('STATUS_SCHEDULED',false),'401999001').players.length,0);
 assert.equal(parseSummary(summary('STATUS_POSTPONED',false),'401999001').status,'postponed');
 assert.equal(parseSummary(summary(),'401999999').status,'unknown');
 const sb=parseScoreboard({events:[{id:'401999001',competitions:[{date:'2026-11-08T00:00Z',status:{type:{name:'STATUS_FINAL',completed:true}},
  competitors:[{homeAway:'home',team:{abbreviation:'BOS'}},{homeAway:'away',team:{abbreviation:'NY'}}]}]}]});
 assert.deepEqual(sb,[{espnEventId:'401999001',start:'2026-11-08T00:00:00.000Z',status:'final',homeAbbr:'BOS',awayAbbr:'NY'}]);
});

test('grading: ties, DNP, absence, postponement window, corrections are new inputs',()=>{
 const base={line:24.5,stat:'points',lockAt:'2026-11-08T00:00:00Z',nowIso:'2026-11-08T04:00:00Z',game:{status:'final'},boxComplete:true};
 const pl=(points)=>({didNotPlay:false,points,rebounds:5,assists:5});
 assert.deepEqual(gradeLine({...base,player:pl(27)}),{state:'graded',outcome:'more',actual:27});
 assert.equal(gradeLine({...base,player:pl(24)}).outcome,'less');
 assert.equal(gradeLine({...base,line:24,player:pl(24)}).outcome,'tie');
 assert.equal(gradeLine({...base,player:{didNotPlay:true,points:null,rebounds:null,assists:null}}).outcome,'void_dnp');
 assert.equal(gradeLine({...base,player:null}).outcome,'void_dnp');
 assert.equal(gradeLine({...base,player:null,boxComplete:false}).reason,'incomplete_box_score');
 assert.equal(gradeLine({...base,nowIso:'2026-11-07T23:00:00Z',player:pl(30)}).reason,'not_started');
 assert.equal(gradeLine({...base,game:{status:'postponed'},player:null}).reason,'postponed_waiting');
 assert.equal(gradeLine({...base,nowIso:'2026-11-09T13:00:00Z',game:{status:'postponed'},player:null}).outcome,'void_postponed');
 assert.equal(gradeLine({...base,game:null,player:null}).reason,'no_verified_result');
});

test('selection band is frozen and explicit',()=>{
 assert.deepEqual(decidePick({status:'scored',pMore:0.66,pLess:0.34,pTie:0}),{status:'recorded',side:'more',probability:0.66,reason:'edge_band'});
 assert.equal(decidePick({status:'scored',pMore:0.3,pLess:0.7,pTie:0}).side,'less');
 assert.equal(decidePick({status:'scored',pMore:0.55,pLess:0.45,pTie:0}).reason,'below_threshold');
 assert.equal(decidePick({status:'scored',pMore:0.9,pLess:0.1,pTie:0}).reason,'extreme_disagreement');
 assert.equal(decidePick({status:'scored',pMore:0.6,pLess:0.3,pTie:0.1}).reason,'tie_risk');
 assert.equal(decidePick({status:'unscorable',pMore:null,pLess:null,pTie:null}).reason,'unscorable');
});

test('entries use different games and players, respect locks and never force a quota',()=>{
 const c=(id,ev,pk,p,lock='2026-11-08T00:00:00Z',platform='prizepicks')=>({pickId:id,platform,eventId:ev,playerKey:pk,teamAbbr:'BOS',probability:p,lockAt:lock});
 const e=buildEntries([c(1,'g1','a',0.7),c(2,'g1','b',0.69),c(3,'g2','c',0.65),c(4,'g3','a',0.64),c(5,'g4','d',0.61,'2026-11-07T20:05:00Z'),c(6,'g5','e',0.62,undefined,'pick6')],
  {platform:'prizepicks',picksPerEntry:2,maxEntries:3,nowIso:'2026-11-07T20:00:00Z',lockBufferMs:600_000});
 // 1+2 share game g1; 5 is inside the lock buffer; 6 is another platform. Pick 2 then pairs with 4 (other game, other player).
 assert.deepEqual(e.map(x=>x.map(l=>l.pickId)),[[1,3],[2,4]]);
 assert.equal(buildEntries([c(1,'g1','a',0.7)],{platform:'prizepicks',picksPerEntry:2,maxEntries:3,nowIso:'2026-11-07T20:00:00Z',lockBufferMs:600_000}).length,0);
});

test('PrizePicks settlement follows the captured standard Power Play table in integer cents',()=>{
 assert.deepEqual(settleEntry('prizepicks',500,['win','win']),{outcome:'won',multiplierMilli:3000,returnCents:1500,profitCents:1000,termsVersion:'prizepicks-power-standard-20261107',wins:2,losses:0,voids:0});
 assert.equal(settleEntry('prizepicks',500,['win','loss']).profitCents,-500);
 assert.equal(settleEntry('prizepicks',500,['win','void']).returnCents,750);
 assert.equal(settleEntry('prizepicks',500,['loss','void']).outcome,'lost');
 assert.equal(settleEntry('prizepicks',500,['void','void']).outcome,'refund');
 assert.equal(settleEntry('prizepicks',500,['win','win','win']).returnCents,3000);
 assert.equal(settleEntry('prizepicks',500,['win','win','void']).returnCents,1500);
 assert.equal(settleEntry('prizepicks',500,['win','void','void']).outcome,'payout_unknown');
 assert.throws(()=>settleEntry('prizepicks',333,['win','void']));
 assert.equal(legResult('more','tie'),'void');
});

test('Pick6 returns stay unknown even for losing sets (peer-to-peer pool)',()=>{
 for(const legs of [['win','win'],['loss','win'],['void','void']]){
  const s=settleEntry('pick6',500,legs);
  assert.equal(s.outcome,'payout_unknown');assert.equal(s.returnCents,null);assert.equal(s.profitCents,null);
 }
});
