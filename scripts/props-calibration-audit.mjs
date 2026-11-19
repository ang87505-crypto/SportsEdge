// Read-only calibration and accounting audit of the props PAPER ledger (GET only; no RPC, no provider, no writes).
// Uses only predictions the database accepted before lock and the latest graded result per line.
import {analyse,expectedVsRealised} from './props-calibration-audit-lib.mjs';

const env=process.env,url=env.SPORTSEDGE_PROPS_SUPABASE_URL??'',key=env.SPORTSEDGE_PROPS_SUPABASE_SERVICE_KEY??'';
let host=null;try{host=new URL(url).hostname;}catch{/* checked below */}
if(!key||host!=='vfyzbliksooljxrlfadp.supabase.co'){console.log(JSON.stringify({error:'NOT_CONFIGURED_OR_UNEXPECTED_PROJECT'}));process.exit(2);}
const headers={apikey:key,...(key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}),Accept:'application/json'};
async function get(path){
 const res=await fetch(`https://${host}/rest/v1/${path}`,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20_000)});
 const text=await res.text();if(!res.ok)throw new Error('HTTP_'+res.status+' '+path.split('?')[0]+' '+text.slice(0,120));
 return JSON.parse(text);
}
const chunk=(xs,n)=>{const o=[];for(let i=0;i<xs.length;i+=n)o.push(xs.slice(i,i+n));return o;};
async function byIds(table,select,col,ids){const out=[];for(const part of chunk([...new Set(ids)],150))out.push(...await get(`${table}?select=${select}&${col}=in.(${part.join(',')})&limit=10000`));return out;}

const FROM=env.FROM||'2026-11-01';
const observations=await get(`props_observations?select=id,platform,provider_event_id,home_team,away_team,lock_at,player_name,stat,line&lock_at=gte.${FROM}&order=id.asc&limit=10000`);
const ids=observations.map(o=>o.id);
const predictions=await byIds('props_predictions','id,observation_id,model_version,status,p_more,p_less,p_tie','observation_id',ids);
const [picks,results]=await Promise.all([byIds('props_picks','id,prediction_id,status,side,selection_version','prediction_id',predictions.map(p=>p.id)),
 byIds('props_line_results','observation_id,revision,outcome,actual','observation_id',ids)]);
let views=[];try{views=await byIds('props_market_views','observation_id,books_at_same_line,p_more_books,line_gap','observation_id',ids);}catch{views=[];}

const out={schemaVersion:'props-calibration-audit-v1',at:new Date().toISOString(),from:FROM,model:'props-nb-minutes-rate-v1',selection:'props-select-v1',
 ...analyse({observations,predictions,picks,results,views,model:'props-nb-minutes-rate-v1',selection:'props-select-v1'})};

// Expected vs realised for PrizePicks v1 entries with known payouts.
const accounts=await get('props_accounts?select=id,slug,platform,selection_version');
const pp=accounts.find(a=>a.slug==='props-prizepicks-v1');
if(pp){
 const entries=await get(`props_entries?select=id,stake_cents&account_id=eq.${pp.id}&limit=5000`);
 const legs=entries.length?await byIds('props_entry_legs','entry_id,pick_id','entry_id',entries.map(e=>e.id)):[];
 const sets=entries.length?await byIds('props_entry_settlements','entry_id,outcome,profit_cents','entry_id',entries.map(e=>e.id)):[];
 const pickRows=legs.length?await byIds('props_picks','id,prediction_id,side','id',legs.map(l=>l.pick_id)):[];
 const preds=pickRows.length?await byIds('props_predictions','id,p_more,p_less','id',pickRows.map(p=>p.prediction_id)):[];
 const pred=new Map(preds.map(p=>[Number(p.id),p]));
 const conf=new Map(pickRows.map(p=>{const q=pred.get(Number(p.prediction_id));if(!q)return [Number(p.id),undefined];const pm=Number(q.p_more)/(Number(q.p_more)+Number(q.p_less));return [Number(p.id),p.side==='more'?pm:1-pm];}));
 const legsBy=new Map();for(const l of legs)legsBy.set(Number(l.entry_id),[...(legsBy.get(Number(l.entry_id))??[]),l]);
 out.prizepicksExpectedVsRealised=expectedVsRealised(entries,legsBy,conf,new Map(sets.map(s=>[Number(s.entry_id),s])));
}
const fmt=x=>JSON.stringify(x);
const L=[`CALIBRATION ${out.at} from ${FROM} model=${out.model}`,
 `LINES unique=${out.uniqueLines} duplicatesExcluded=${out.duplicatesExcluded} graded=${out.graded} ties=${out.ties} voidOrDnp=${out.voidOrDnp} ungraded=${out.ungradedLines} correctedResults=${out.correctedResults} changedOnCorrection=${out.resultChangedOnCorrection}`,
 `ALL_LINES ${fmt(out.allLines)}`,...out.allLineBuckets.map(b=>`ALL_BUCKET ${fmt(b)}`),
 `PICKS ${fmt(out.picks)}`,...out.pickBuckets.map(b=>`PICK_BUCKET ${fmt(b)}`),
 ...out.byStat.map(b=>`BY_STAT ${fmt(b)}`),...out.bySide.map(b=>`BY_SIDE ${fmt(b)}`),...out.byBookConsensus.map(b=>`BY_BOOKS ${fmt(b)}`),
 ...out.byLineGap.map(b=>`BY_LINE_GAP ${fmt(b)}`),...out.byGame.map(b=>`BY_GAME ${fmt(b)}`),...out.byPlayerTop.map(b=>`BY_PLAYER ${fmt(b)}`),
 `EXPECTED_VS_REALISED ${fmt(out.prizepicksExpectedVsRealised??null)}`,out.smallGroupNote];
console.log(L.join('\n'));
if(env.GITHUB_STEP_SUMMARY){const {appendFileSync}=await import('node:fs');appendFileSync(env.GITHUB_STEP_SUMMARY,'## Props calibration audit (read-only)\n\n```\n'+L.join('\n')+'\n```\n');}
