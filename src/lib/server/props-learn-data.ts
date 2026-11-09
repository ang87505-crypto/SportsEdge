/**
 * Read-only loaders for the learning loop. SERVER/WORKER ONLY.
 * Forward lines join each observation with its predictions (every model version), picks, market
 * view, latest graded result and the player's actual minutes. Missing data stays missing.
 */
import type {PropsStore} from './props-store.ts';
import type {TeamGameRow} from '../props/features.ts';
import type {Platform,Stat} from '../props/contract.ts';
import {playerKey} from '../props/identity.ts';

const q=encodeURIComponent;
const PAGE=1000,IDS=150;
const chunk=<T,>(xs:T[],n:number)=>Array.from({length:Math.ceil(xs.length/n)},(_,i)=>xs.slice(i*n,i*n+n));
const inList=(xs:(string|number)[])=>'in.('+xs.map(x=>typeof x==='number'?String(x):'"'+String(x).replace(/["\\]/g,'')+'"').join(',')+')';
const etDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));

async function paged<T>(store:PropsStore,table:string,query:string,max=40):Promise<T[]>{
 const out:T[]=[];
 for(let page=0;page<max;page++){const got=await store.select<T>(table,query+'&limit='+PAGE+'&offset='+page*PAGE);out.push(...got);if(got.length<PAGE)break;}
 return out;
}
async function byIds<T>(store:PropsStore,table:string,select:string,column:string,ids:(string|number)[]):Promise<T[]>{
 const out:T[]=[];
 for(const part of chunk([...new Set(ids)],IDS))out.push(...await store.select<T>(table,'select='+select+'&'+column+'='+inList(part)+'&limit=5000'));
 return out;
}

type PG={espn_event_id:string;athlete_id:string;team_abbr:string;opponent_abbr:string;game_start:string;game_status:string;
 did_not_play:boolean;minutes:number|null;points:number|null;rebounds:number|null;assists:number|null;revision:number};

/** Final player rows since a date (latest revision), as matchup-feature input. */
export async function loadTeamRows(store:PropsStore,sinceIso:string):Promise<TeamGameRow[]>{
 const rows=await paged<PG>(store,'props_player_games','select=espn_event_id,athlete_id,team_abbr,opponent_abbr,game_start,game_status,'+
  'did_not_play,minutes,points,rebounds,assists,revision&game_start=gte.'+q(sinceIso)+'&order=id.asc');
 const latest=new Map<string,PG>();
 for(const r of rows){const k=r.espn_event_id+'|'+r.athlete_id;const p=latest.get(k);if(!p||r.revision>p.revision)latest.set(k,r);}
 return [...latest.values()].filter(r=>r.game_status==='final').map(r=>({espnEventId:r.espn_event_id,teamAbbr:r.team_abbr,
  opponentAbbr:r.opponent_abbr,gameStart:r.game_start,minutes:r.minutes===null?null:Number(r.minutes),points:r.points,
  rebounds:r.rebounds,assists:r.assists,didNotPlay:r.did_not_play}));
}

export type Probs={pMore:number;pLess:number;pTie:number};
export type ForwardLine={observationId:number;platform:Platform;eventId:string;playerName:string;stat:Stat;line:number;lockAt:string;
 ingestedAt:string;homeTeam:string;awayTeam:string;date:string;key:string;
 outcome:'more'|'less'|'tie'|'void'|null;gradedAt:string|null;actualMinutes:number|null;athleteId:string|null;team:string|null;
 predictions:Record<string,{id:number;probs:Probs;inputs:Record<string,unknown>}>;
 market:{booksAtSameLine:number;pMoreBooks:number|null;lineGap:number|null;nearestBookLine:number|null;flags:string[]}|null;
 picks:{selectionVersion:string;modelVersion:string;status:string;side:'more'|'less'|null}[]};

type Obs={id:number;platform:Platform;provider_event_id:string;home_team:string;away_team:string;lock_at:string;ingested_at:string;
 player_name:string;stat:Stat;line:number};
type Pred={id:number;observation_id:number;model_version:string;status:string;athlete_id:string|null;p_more:number|null;p_less:number|null;
 p_tie:number|null;inputs:Record<string,unknown>};

/** Every observation whose lock is at or after `sinceIso`, with everything the learning loop needs. */
export async function loadForwardLines(store:PropsStore,sinceIso:string):Promise<ForwardLine[]>{
 const obs=await paged<Obs>(store,'props_observations','select=id,platform,provider_event_id,home_team,away_team,lock_at,ingested_at,'+
  'player_name,stat,line&lock_at=gte.'+q(sinceIso)+'&order=id.asc');
 if(!obs.length)return [];
 const ids=obs.map(o=>o.id);
 const [preds,results]=await Promise.all([
  byIds<Pred>(store,'props_predictions','id,observation_id,model_version,status,athlete_id,p_more,p_less,p_tie,inputs','observation_id',ids),
  byIds<{observation_id:number;revision:number;outcome:string;graded_at:string;player_game_id:number|null}>(store,'props_line_results',
   'observation_id,revision,outcome,graded_at,player_game_id','observation_id',ids)]);
 const picks=preds.length?await byIds<{prediction_id:number;selection_version:string;status:string;side:'more'|'less'|null}>(store,'props_picks',
  'prediction_id,selection_version,status,side','prediction_id',preds.map(p=>p.id)):[];
 let views:{observation_id:number;books_at_same_line:number;p_more_books:number|null;line_gap:number|null;nearest_book_line:number|null;flags:string[]}[]=[];
 try{views=await byIds(store,'props_market_views','observation_id,books_at_same_line,p_more_books,line_gap,nearest_book_line,flags','observation_id',ids);}
 catch{/* market tables not migrated: market stays unknown */}
 const latest=new Map<number,typeof results[number]>();
 for(const r of results){const p=latest.get(r.observation_id);if(!p||r.revision>p.revision)latest.set(r.observation_id,r);}
 const gameIds=[...latest.values()].map(r=>r.player_game_id).filter((x):x is number=>x!==null);
 const minutes=new Map((gameIds.length?await byIds<{id:number;minutes:number|null}>(store,'props_player_games','id,minutes','id',gameIds):[])
  .map(r=>[r.id,r.minutes===null?null:Number(r.minutes)]));
 // The team is stored with each prediction since the review fix; older rows fall back to a bounded,
 // paged lookup of the player's games in the 30 days before the earliest lock (never an unbounded read).
 const teamOfPred=new Map<number,string>();
 for(const p of preds){const t=(p.inputs as {team?:unknown}|null)?.team;if(typeof t==='string'&&/^[A-Z]{2,4}$/.test(t))teamOfPred.set(p.observation_id,t);}
 const missing=[...new Set(preds.filter(p=>p.athlete_id&&!teamOfPred.has(p.observation_id)).map(p=>p.athlete_id as string))];
 const games:{athlete_id:string;team_abbr:string;game_start:string}[]=[];
 if(missing.length){
  const from=new Date(Math.min(...obs.map(o=>Date.parse(o.lock_at)))-30*86400_000).toISOString();
  for(const part of chunk(missing,IDS))games.push(...await paged<{athlete_id:string;team_abbr:string;game_start:string}>(store,'props_player_games',
   'select=athlete_id,team_abbr,game_start&athlete_id='+inList(part)+'&game_start=gte.'+q(from)+'&order=id.asc'));
 }
 const teamAt=(obsId:number,athlete:string|null,lock:string)=>{
  const stored=teamOfPred.get(obsId);if(stored)return stored;
  if(!athlete)return null;
  const before=games.filter(g=>g.athlete_id===athlete&&g.game_start<lock).sort((a,b)=>b.game_start.localeCompare(a.game_start));
  return before[0]?.team_abbr??null;
 };
 const predsByObs=new Map<number,Pred[]>();for(const p of preds)predsByObs.set(p.observation_id,[...(predsByObs.get(p.observation_id)??[]),p]);
 const predById=new Map(preds.map(p=>[p.id,p]));
 const picksByObs=new Map<number,ForwardLine['picks']>();
 for(const k of picks){const p=predById.get(k.prediction_id);if(!p)continue;
  picksByObs.set(p.observation_id,[...(picksByObs.get(p.observation_id)??[]),{selectionVersion:k.selection_version,modelVersion:p.model_version,status:k.status,side:k.side}]);}
 const viewByObs=new Map(views.map(v=>[v.observation_id,v]));
 return obs.map(o=>{
  const ps=predsByObs.get(o.id)??[];
  const r=latest.get(o.id);
  const v=viewByObs.get(o.id);
  const athleteId=ps.find(p=>p.athlete_id)?.athlete_id??null;
  return {observationId:o.id,platform:o.platform,eventId:o.provider_event_id,playerName:o.player_name,stat:o.stat,line:Number(o.line),
   lockAt:o.lock_at,ingestedAt:o.ingested_at,homeTeam:o.home_team,awayTeam:o.away_team,date:etDate(o.lock_at),
   key:[o.provider_event_id,playerKey(o.player_name),o.stat,Number(o.line)].join('|'),
   outcome:!r?null:r.outcome==='more'||r.outcome==='less'||r.outcome==='tie'?r.outcome:'void',gradedAt:r?.graded_at??null,
   actualMinutes:r?.player_game_id?minutes.get(r.player_game_id)??null:null,athleteId,team:teamAt(o.id,athleteId,o.lock_at),
   predictions:Object.fromEntries(ps.filter(p=>p.status==='scored').map(p=>[p.model_version,{id:p.id,
    probs:{pMore:Number(p.p_more),pLess:Number(p.p_less),pTie:Number(p.p_tie)},inputs:p.inputs??{}}])),
   market:v?{booksAtSameLine:Number(v.books_at_same_line),pMoreBooks:v.p_more_books===null?null:Number(v.p_more_books),
    lineGap:v.line_gap===null?null:Number(v.line_gap),nearestBookLine:v.nearest_book_line===null?null:Number(v.nearest_book_line),flags:v.flags??[]}:null,
   picks:picksByObs.get(o.id)??[]};
 });
}
