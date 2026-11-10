/**
 * Read-only audit of the live props ledger (GitHub Actions with the existing props secrets). Never writes, never
 * calls a paid provider. Prints one JSON report:
 *  - shadow lines per model version: scored, graded, void, awaiting settlement, not yet locked
 *  - grading: every latest result recomputed from the stored box-score row (mismatches listed)
 *  - identity, team, game time, minutes and stat-revision checks
 *  - real captured lines (deduplicated across platforms): layer 1 vs props-nb-role-minutes-v1 vs the
 *    timestamp-matched no-vig sportsbook probability at the exact same line, with game-level intervals
 *  - settled virtual entries (descriptive; separate from probability quality)
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {propsStore} from '../src/lib/server/props-store.ts';
import {loadForwardLines} from '../src/lib/server/props-learn-data.ts';
import {predictLine,type GameLog,type ModelParams,type PriorSummary} from '../src/lib/props/model.ts';
import {MODEL_VERSION,STATS,type Stat} from '../src/lib/props/contract.ts';
import {recomputeOutcome} from '../src/lib/props/audit.ts';

const SINCE='2026-11-01T00:00:00Z';
const production=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8'));
const store=propsStore();
const nowIso=new Date().toISOString(),now=Date.parse(nowIso);
async function all<T>(table:string,query:string):Promise<T[]>{
 const out:T[]=[];
 for(let offset=0;offset<50_000;offset+=1000){
  const page=await store.select<T>(table,query+'&limit=1000&offset='+offset);
  out.push(...page);if(page.length<1000)return out;
 }
 throw new Error('AUDIT_PAGE_LIMIT');
}
const lines=await loadForwardLines(store,SINCE);

// ---------- shadow lines per model version
const versions=[...new Set(lines.flatMap(l=>Object.keys(l.predictions)))];
const shadow=Object.fromEntries(versions.map(v=>{
 const mine=lines.filter(l=>l.predictions[v]);
 const graded=mine.filter(l=>l.outcome==='more'||l.outcome==='less'||l.outcome==='tie');
 return [v,{scored:mine.length,graded:graded.length,void:mine.filter(l=>l.outcome==='void').length,
  awaitingSettlement:mine.filter(l=>l.outcome===null&&Date.parse(l.lockAt)<=now).length,
  notLockedYet:mine.filter(l=>l.outcome===null&&Date.parse(l.lockAt)>now).length,
  firstLock:mine.map(l=>l.lockAt).sort()[0]??null,lastLock:mine.map(l=>l.lockAt).sort().at(-1)??null,
  pairedWithLayer1AndGraded:v===MODEL_VERSION?null:graded.filter(l=>l.predictions[MODEL_VERSION]).length}];
}));
const settles=await store.select<{slot_key:string;started_at:string;outcome:string}>('props_runs',
 'select=slot_key,started_at,outcome&kind=eq.settle&status=eq.completed&order=id.desc&limit=5');

// ---------- grading, identity, team, time, minutes, revisions
type Res={observation_id:number;revision:number;outcome:string;actual:number|null;graded_at:string;player_game_id:number|null};
type PG={id:number;athlete_id:string;team_abbr:string;game_start:string;did_not_play:boolean;minutes:number|null;
 points:number|null;rebounds:number|null;assists:number|null;revision:number;espn_event_id:string};
const results=await all<Res>('props_line_results','select=observation_id,revision,outcome,actual,graded_at,player_game_id&order=id.asc');
const latest=new Map<number,Res>();for(const r of results){const p=latest.get(r.observation_id);if(!p||r.revision>p.revision)latest.set(r.observation_id,r);}
const pgIds=[...new Set([...latest.values()].map(r=>r.player_game_id).filter((x):x is number=>x!==null))];
const games:PG[]=[];
for(let i=0;i<pgIds.length;i+=100)games.push(...await store.select<PG>('props_player_games',
 'select=id,athlete_id,team_abbr,game_start,did_not_play,minutes,points,rebounds,assists,revision,espn_event_id&id=in.('+pgIds.slice(i,i+100).join(',')+')&limit=1000'));
const gameById=new Map(games.map(g=>[g.id,g]));
const byObs=new Map(lines.map(l=>[l.observationId,l]));
const gradingMismatches:unknown[]=[];let gradedChecked=0,playedMinutesMissing=0,teamMismatch=0,teamChecked=0;
const lockGapMinutes:number[]=[];let lockAfterStart=0;
for(const [obsId,r] of latest){
 const l=byObs.get(obsId),g=r.player_game_id?gameById.get(r.player_game_id):undefined;
 if(!l||!g)continue;
 gradedChecked++;
 const expected=recomputeOutcome(l.line,l.stat,g);
 if(expected!==r.outcome)gradingMismatches.push({obsId,stat:l.stat,line:l.line,stored:r.outcome,recomputed:expected});
 if(!g.did_not_play&&g.minutes===null)playedMinutesMissing++;
 if(l.team){teamChecked++;if(l.team!==g.team_abbr)teamMismatch++;}
 lockGapMinutes.push((Date.parse(g.game_start)-Date.parse(l.lockAt))/60_000);
 if(Date.parse(l.lockAt)>Date.parse(g.game_start))lockAfterStart++;
}
const revisions=results.filter(r=>r.revision>1);
const changedOnRevision=revisions.filter(r=>{const first=results.find(x=>x.observation_id===r.observation_id&&x.revision===1);return first&&first.outcome!==r.outcome;});
const preds=await all<{model_version:string;status:string;reason:string|null;athlete_id:string|null}>('props_predictions',
 'select=model_version,status,reason,athlete_id&model_version=eq.'+MODEL_VERSION+'&predicted_at=gte.'+encodeURIComponent(SINCE)+'&order=id.asc');
const unscored:Record<string,number>={};for(const p of preds)if(p.status!=='scored'){const k=String(p.reason??p.status);unscored[k]=(unscored[k]??0)+1;}
const names=new Map<string,Set<string>>();for(const l of lines)if(l.athleteId){const s=names.get(l.playerName)??new Set();s.add(l.athleteId);names.set(l.playerName,s);}

// ---------- real captured lines: layer 1 vs role variant vs books (same line, same reply)
const dedup=new Map<string,typeof lines[number]>();
for(const l of lines.filter(x=>x.outcome==='more'||x.outcome==='less')){
 const prev=dedup.get(l.key);if(!prev||(prev.platform!=='prizepicks'&&l.platform==='prizepicks'))dedup.set(l.key,l);
}
const graded=[...dedup.values()].filter(l=>l.predictions[MODEL_VERSION]&&l.athleteId);
const athletes=[...new Set(graded.map(l=>l.athleteId as string))];
const history:PG[]=[];
for(let i=0;i<athletes.length;i+=50)history.push(...await all<PG>('props_player_games',
 'select=id,athlete_id,team_abbr,game_start,did_not_play,minutes,points,rebounds,assists,revision,espn_event_id&athlete_id=in.('+athletes.slice(i,i+50).join(',')+')&order=id.asc'));
const logsOf=(a:string)=>{const latestRev=new Map<string,PG>();for(const g of history.filter(h=>h.athlete_id===a)){const p=latestRev.get(g.espn_event_id);if(!p||g.revision>p.revision)latestRev.set(g.espn_event_id,g);}
 return [...latestRev.values()].map(g=>({gameStart:g.game_start,minutes:g.minutes===null?null:Number(g.minutes),didNotPlay:g.did_not_play,
  points:g.points,rebounds:g.rebounds,assists:g.assists})) as GameLog[];};
const roleParams:ModelParams={...production.params,version:'props-nb-role-minutes-v1',roleChange:{recentGames:3,minShift:6}};
const noTie=(p:{pMore:number;pLess:number})=>p.pMore/(p.pMore+p.pLess);
type Cmp={stat:Stat;eventId:string;y:0|1;layer1:number;role:number|null;books:number|null;storedVsRecomputed:number|null};
const cmp:Cmp[]=graded.map(l=>{
 const stored=noTie(l.predictions[MODEL_VERSION].probs);
 const cutoff=l.lockAt;  // the stored prediction's own cutoff is pre-lock; history strictly before it
 const logs=logsOf(l.athleteId as string);
 const prior=(production.players as Record<string,PriorSummary>)[l.athleteId as string]??null;
 const v1=predictLine({logs,prior,stat:l.stat,line:l.line,cutoff,params:production.params});
 const r=predictLine({logs,prior,stat:l.stat,line:l.line,cutoff,params:roleParams});
 const books=l.market&&l.market.booksAtSameLine>0?l.market.pMoreBooks:null;
 return {stat:l.stat,eventId:l.eventId,y:l.outcome==='more'?1:0,layer1:stored,
  role:r.status==='scored'?noTie(r):null,books,storedVsRecomputed:v1.status==='scored'?Math.abs(noTie(v1)-stored):null};
});
const brier=(xs:Cmp[],k:'layer1'|'role'|'books')=>xs.length?+(xs.reduce((a,x)=>a+((x[k] as number)-x.y)**2,0)/xs.length).toFixed(5):null;
function gameCi(xs:Cmp[],k:'role'|'books'){
 const g=new Map<string,{d:number;n:number}>();for(const x of xs){const v=g.get(x.eventId)??{d:0,n:0};v.d+=((x[k] as number)-x.y)**2-(x.layer1-x.y)**2;v.n++;g.set(x.eventId,v);}
 const list=[...g.values()];if(list.length<5)return {games:list.length,note:'too few games for an interval'};
 let s=20261110>>>0;const rnd=()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296;};const reps:number[]=[];
 for(let k=0;k<1000;k++){let d=0,n=0;for(let i=0;i<list.length;i++){const v=list[Math.floor(rnd()*list.length)];d+=v.d;n+=v.n;}reps.push(d/n);}
 reps.sort((a,b)=>a-b);return {games:list.length,lower95:+reps[24].toFixed(5),upper95:+reps[974].toFixed(5)};
}
const realLines=Object.fromEntries(STATS.map(st=>{
 const xs=cmp.filter(x=>x.stat===st),withRole=xs.filter(x=>x.role!==null),withBooks=xs.filter(x=>x.books!==null);
 return [st,{lines:xs.length,games:new Set(xs.map(x=>x.eventId)).size,layer1Brier:brier(xs,'layer1'),
  roleVariant:{n:withRole.length,layer1:brier(withRole,'layer1'),role:brier(withRole,'role'),differenceInterval:gameCi(withRole,'role')},
  booksSameLine:{n:withBooks.length,layer1:brier(withBooks,'layer1'),books:brier(withBooks,'books'),differenceInterval:gameCi(withBooks,'books')}}];
}));
const recomputeGap=cmp.map(x=>x.storedVsRecomputed).filter((x):x is number=>x!==null);

// ---------- settled virtual entries (descriptive only)
const settlements=await all<{outcome:string;return_cents:number|null;profit_cents:number|null}>('props_entry_settlements','select=outcome,return_cents,profit_cents&order=entry_id.asc');

const report={generatedAt:nowIso,since:SINCE,observations:lines.length,
 shadowLines:{byModel:shadow,recentSettles:settles,
  explanation:'A shadow line counts as graded only when the line has a final result. Lines scored after the most recent completed settle are awaiting settlement, not missing.'},
 grading:{checked:gradedChecked,mismatches:gradingMismatches.length,examples:gradingMismatches.slice(0,10),
  revisionsAfterFirst:revisions.length,outcomeChangedByRevision:changedOnRevision.length},
 identity:{layer1Predictions:preds.length,unscoredByReason:unscored,namesWithMoreThanOneAthleteId:[...names].filter(([,s])=>s.size>1).map(([n])=>n)},
 team:{checked:teamChecked,mismatches:teamMismatch},
 gameTime:{checked:lockGapMinutes.length,lockAfterGameStart:lockAfterStart,
  minutesFromLockToStart:lockGapMinutes.length?{min:Math.min(...lockGapMinutes),max:Math.max(...lockGapMinutes)}:null},
 minutes:{playedWithoutMinutes:playedMinutesMissing},
 realCapturedLines:{dedupedGradedLines:cmp.length,byStat:realLines,
  layer1Reproduction:{n:recomputeGap.length,maxAbsDifference:recomputeGap.length?+Math.max(...recomputeGap).toFixed(6):null,
   note:'Layer 1 recomputed from the ledger history should match the stored prediction; a gap means the stored history at prediction time differed (later backfill or revision).'}},
 settledEntries:{count:settlements.length,byOutcome:settlements.reduce((a:Record<string,number>,s)=>({...a,[s.outcome]:(a[s.outcome]??0)+1}),{}),
  knownReturnCents:settlements.reduce((a,s)=>a+(s.return_cents??0),0),knownProfitCents:settlements.reduce((a,s)=>a+(s.profit_cents??0),0),
  note:'Descriptive only; far too few to judge profitability, and not used to fit anything.'}};
writeFileSync(process.argv[2]??'props-audit.json',JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify(report,null,1));
