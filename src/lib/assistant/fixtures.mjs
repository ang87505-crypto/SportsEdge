// Synthetic TEST-ONLY props ledger for assistant tests. Never a genuine observation.
// "Now" is Mon Nov 9, 12:00 PM MST. Last night = Nov 8 MT (locks Nov 9 01:00Z / 02:30Z); tonight locks Nov 10 02:00Z / 03:00Z.
import {buildView} from '../props/dashboard-view.ts';

export const NOW='2026-11-09T19:00:00.000Z';
const Y1='2026-11-09T01:00:00.000Z',Y2='2026-11-09T02:30:00.000Z',T1='2026-11-10T02:00:00.000Z',T2='2026-11-10T03:00:00.000Z';

export function makeRaw({graded=true,tonight=true,nowIso=NOW,model=null,report=null,control=null}={}){
 const obs=[],pred=[],picks=[],results=[];
 const add=(id,{player,stat='points',line=20.5,lock,ev,pMore,side,decision='recorded',result=null,platform='prizepicks',mean=21})=>{
  obs.push({id,platform,provider_event_id:ev,home_team:'Test Home '+ev,away_team:'Test Away '+ev,lock_at:lock,player_name:player,stat,line,
   provider_last_update:'2026-11-08T18:00:00.000Z',ingested_at:'2026-11-08T18:05:00.000Z'});
  pred.push({id:1000+id,observation_id:id,model_version:'props-nb-minutes-rate-v1',status:'scored',reason:'ok',p_more:pMore,p_less:+(1-pMore-0.01).toFixed(4),
   p_tie:0.01,mean,inputs:{expMinutes:32}});
  picks.push({id:2000+id,prediction_id:1000+id,status:decision,side:decision==='recorded'?side:null,reason:decision==='recorded'?'edge_band':'below_threshold',
   selection_version:'props-select-v1'});
  if(result)results.push({observation_id:id,revision:1,outcome:result.outcome,actual:result.actual});
 };
 // Last night: 14 recorded More picks; the first 9 went over.
 for(let i=0;i<14;i++){
  const correct=i<9;
  add(i+1,{player:'Last Night Player '+(i+1),lock:i%2?Y2:Y1,ev:i%2?'evtTESTY00002':'evtTESTY00001',pMore:0.66,side:'more',
   result:graded?{outcome:correct?'more':'less',actual:correct?25:15}:null});
 }
 add(15,{player:'Last Night Skipped',lock:Y1,ev:'evtTESTY00001',pMore:0.52,decision:'skipped',result:graded?{outcome:'more',actual:24}:null});
 if(tonight){
  add(21,{player:'Devin Booker',stat:'rebounds',line:11.5,lock:T1,ev:'evtTESTT00001',pMore:0.74,side:'more',mean:12.5});
  add(22,{player:'Trae Young',stat:'assists',line:9.5,lock:T2,ev:'evtTESTT00002',pMore:0.68,side:'more',mean:10.5});
  add(23,{player:'Domantas Sabonis',stat:'rebounds',line:11.5,lock:T1,ev:'evtTESTT00001',pMore:0.35,side:'less',mean:10.6});
  add(24,{player:'Bam Adebayo',stat:'points',line:24.5,lock:T2,ev:'evtTESTT00002',pMore:0.52,decision:'skipped',mean:24.9});
  add(25,{player:'Devin Booker',stat:'points',line:26.5,lock:T1,ev:'evtTESTT00001',pMore:0.55,decision:'skipped',platform:'pick6',mean:27});
 }
 // Entries #7–#9 from last night's picks, each across both games.
 const entry=(id,legs,s)=>({entry:{id,account_id:1,stake_cents:500,lock_at:Y1,created_at:'2026-11-08T18:06:00.000Z',payout_terms_version:'t'},
  legs:legs.map(l=>({entry_id:id,pick_id:2000+l})),settlement:graded?{entry_id:id,...s,settled_at:'2026-11-09T09:30:00.000Z'}:null});
 const es=[entry(7,[1,2],{outcome:'won',wins:2,losses:0,voids:0,return_cents:1500,profit_cents:1000}),
  entry(8,[3,10],{outcome:'lost',wins:1,losses:1,voids:0,return_cents:0,profit_cents:-500}),
  entry(9,[5,6],{outcome:'won',wins:2,losses:0,voids:0,return_cents:1500,profit_cents:1000})];
 return {nowIso,control:control??{state:'RUNNING',reason:'Released after verified cycle',changed_at:'2026-11-07T00:00:00Z'},
  runs:[{id:6,kind:'collect',slot_key:'collect-2026-11-08T19',status:'completed',outcome:'COMPLETED',started_at:'2026-11-08T22:50:00Z',
   finished_at:'2026-11-08T22:50:09Z',start_delay_seconds:13203,summary:{}}],credits:[],providerRemaining:485,
  observations:obs,predictions:pred,picks,results,
  accounts:[{id:1,slug:'props-prizepicks-v1',platform:'prizepicks',selection_version:'props-select-v1',initial_cents:50000,stake_cents:500,max_entries_per_day:3},
   {id:2,slug:'props-pick6-v1',platform:'pick6',selection_version:'props-select-v1',initial_cents:50000,stake_cents:500,max_entries_per_day:3}],
  entries:es.map(e=>e.entry),legs:es.flatMap(e=>e.legs),settlements:es.flatMap(e=>e.settlement?[e.settlement]:[]),
  model,views:[],report};
}

export function makeData(opts={},extra={}){
 const raw=makeRaw(opts);
 return {nowIso:raw.nowIso,pp:buildView(raw,'prizepicks'),p6:buildView(raw,'pick6'),control:raw.control,
  nextCollect:'2026-11-09T19:10:00.000Z',nextSettle:'2026-11-10T09:20:00.000Z',...extra};
}

export const MODEL={active:'props-learn-v2',previous:'props-nb-minutes-rate-v1',learningEnabled:true,autoSwitchEnabled:false,weights:null,
 events:[{id:9,version:'props-learn-v4',event:'shadow_start',reason:'ok',detail:{},at:'2026-11-08T10:00:00Z'},
  {id:8,version:'props-learn-v3',event:'eligible',reason:'ok',detail:{},at:'2026-11-07T10:00:00Z'},
  {id:7,version:'props-learn-v2',event:'promoted',reason:'ok',detail:{},at:'2026-11-01T10:00:00Z'}]};
export const REPORT={period_from:'2026-11-01',period_to:'2026-11-07',model_version:'props-learn-v2',at:'2026-11-08T10:05:00Z',
 report:{misses:{minutes_collapse:3,books_were_right:2,matchup:1,overconfidence:0,other:1},voidsExcluded:1,overconfidentBands:[]}};
