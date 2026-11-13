// Pure analysis for the read-only props calibration audit. Uses only predictions recorded before lock and the
// latest graded result per line; never reconstructs a missing prediction. No I/O.

export const BUCKETS=[[0,0.55],[0.55,0.6],[0.6,0.65],[0.65,0.7],[0.7,0.75],[0.75,0.8],[0.8,1.01]];
const label=([a,b])=>`${Math.round(a*100)}-${b>1?100:Math.round(b*100)}%`;
const r4=x=>x===null||!Number.isFinite(x)?null:Math.round(x*1e4)/1e4;

export function wilson(k,n,z=1.96){
 if(!n)return [null,null];
 const p=k/n,z2=z*z,d=1+z2/n,c=p+z2/(2*n),h=z*Math.sqrt(p*(1-p)/n+z2/(4*n*n));
 return [r4((c-h)/d),r4((c+h)/d)];
}

/** Latest revision per observation, plus counts of corrections and outcome changes. */
export function latestResults(results){
 const by=new Map();let corrected=0,changed=0;
 for(const r of [...results].sort((a,b)=>a.revision-b.revision)){
  const prev=by.get(Number(r.observation_id));
  if(prev){corrected++;if(prev.outcome!==r.outcome)changed++;}
  by.set(Number(r.observation_id),r);
 }
 return {by,corrected,changed};
}

/**
 * One row per unique line (event|player|stat|line): the first-recorded prediction of `model` wins, so the same line
 * on two platforms is never counted twice. Rows carry P(more) normalised over more/less, the outcome and the pick.
 */
export function buildRows({observations,predictions,picks,results,views,model,selection}){
 const obs=new Map(observations.map(o=>[Number(o.id),o]));
 const pickByPred=new Map(picks.filter(p=>p.selection_version===selection).map(p=>[Number(p.prediction_id),p]));
 const view=new Map((views??[]).map(v=>[Number(v.observation_id),v]));
 const {by:res,corrected,changed}=latestResults(results);
 const seen=new Map();let duplicates=0;
 for(const p of [...predictions].filter(p=>p.model_version===model&&p.status==='scored'&&p.p_more!==null&&p.p_less!==null).sort((a,b)=>a.id-b.id)){
  const o=obs.get(Number(p.observation_id));if(!o)continue;
  const key=[o.provider_event_id,o.player_name.toLowerCase(),o.stat,Number(o.line)].join('|');
  if(seen.has(key)){duplicates++;continue;}
  const pm=Number(p.p_more),pl=Number(p.p_less),pk=pickByPred.get(Number(p.id))??null,r=res.get(Number(o.id))??null,v=view.get(Number(o.id))??null;
  seen.set(key,{key,obsId:Number(o.id),event:o.provider_event_id,game:`${o.away_team} @ ${o.home_team}`,player:o.player_name,stat:o.stat,line:Number(o.line),
   lockAt:o.lock_at,pMore:pm/(pm+pl),outcome:r?.outcome??null,actual:r?.actual??null,
   picked:pk?.status==='recorded'?pk.side:null,pickId:pk?Number(pk.id):null,
   booksAtLine:v?Number(v.books_at_same_line):null,pMoreBooks:v?.p_more_books===null||v?.p_more_books===undefined?null:Number(v.p_more_books),
   lineGap:v?.line_gap===null||v?.line_gap===undefined?null:Number(v.line_gap)});
 }
 return {rows:[...seen.values()],duplicates,corrected,changed};
}

const graded=r=>r.outcome==='more'||r.outcome==='less';
function score(rows){
 const g=rows.filter(graded);
 if(!g.length)return {n:0,brier:null,logLoss:null,meanPMore:null,moreRate:null};
 let b=0,ll=0,pm=0,mo=0;
 for(const r of g){const y=r.outcome==='more'?1:0,p=Math.min(Math.max(r.pMore,1e-6),1-1e-6);b+=(p-y)**2;ll+=-(y*Math.log(p)+(1-y)*Math.log(1-p));pm+=r.pMore;mo+=y;}
 return {n:g.length,brier:r4(b/g.length),logLoss:r4(ll/g.length),meanPMore:r4(pm/g.length),moreRate:r4(mo/g.length)};
}
function group(items,keyOf){
 const m=new Map();
 for(const x of items){const k=keyOf(x);if(k===null)continue;m.set(k,[...(m.get(k)??[]),x]);}
 return m;
}
/** Hit statistics for a set of picks: stated confidence, realised hit rate, Wilson range, gap. */
function hits(ps){
 const n=ps.length,k=ps.filter(p=>p.hit).length,conf=n?ps.reduce((a,p)=>a+p.conf,0)/n:null;
 const [lo,hi]=wilson(k,n);
 return {n,hits:k,hitRate:n?r4(k/n):null,meanConf:r4(conf),gap:n?r4(conf-k/n):null,low:lo,high:hi};
}

export function analyse(input,{minGroup=5}={}){
 const {rows,duplicates,corrected,changed}=buildRows(input);
 const all=score(rows);
 // Calibration of every scored line, on the probability of the side the model favoured.
 const sideRows=rows.filter(graded).map(r=>{const side=r.pMore>=0.5?'more':'less';const conf=side==='more'?r.pMore:1-r.pMore;return {...r,side,conf,hit:r.outcome===side};});
 const allBuckets=BUCKETS.map(b=>({bucket:label(b),...hits(sideRows.filter(r=>r.conf>=b[0]&&r.conf<b[1]))})).filter(x=>x.n);
 // Recorded picks only.
 const picks=rows.filter(r=>r.picked&&graded(r)).map(r=>{const conf=r.picked==='more'?r.pMore:1-r.pMore;return {...r,conf,hit:r.outcome===r.picked};});
 const pending=rows.filter(r=>r.picked&&!r.outcome).length;
 const voided=rows.filter(r=>r.picked&&r.outcome&&!graded(r)).length;
 const n=picks.length,meanGap=n?picks.reduce((a,p)=>a+p.conf-(p.hit?1:0),0)/n:null;
 const se=n?Math.sqrt(picks.reduce((a,p)=>a+(p.conf*(1-p.conf)),0))/n:null;
 const named=(m,limit)=>[...m.entries()].map(([k,v])=>({key:k,...hits(v)})).sort((a,b)=>b.n-a.n||String(a.key).localeCompare(String(b.key))).slice(0,limit);
 const bookView=p=>p.pMoreBooks===null?'no book quote at the same line':((p.picked==='more')===(p.pMoreBooks>=0.5)?'books agree with the pick':'books disagree with the pick');
 const gapView=p=>p.lineGap===null?'no nearest book line':Math.abs(p.lineGap)<0.25?'same as books':Math.abs(p.lineGap)<=1?'0.5-1 from books':'more than 1 from books';
 const players=named(group(picks,p=>p.player),25).filter(x=>x.n>=2);
 return {uniqueLines:rows.length,duplicatesExcluded:duplicates,correctedResults:corrected,resultChangedOnCorrection:changed,
  graded:all.n,ties:rows.filter(r=>r.outcome==='tie').length,voidOrDnp:rows.filter(r=>r.outcome&&!graded(r)&&r.outcome!=='tie').length,
  ungradedLines:rows.filter(r=>!r.outcome).length,allLines:all,allLineBuckets:allBuckets,
  picks:{...hits(picks),pending,voided,overconfidence:{meanGap:r4(meanGap),approxSe:r4(se),
   z:meanGap!==null&&se?r4(meanGap/se):null,
   verdict:!n?'no graded picks':Math.abs(meanGap/se)<2?'not distinguishable from calibrated at this sample size':meanGap>0?'overconfident (gap more than 2 standard errors)':'underconfident (gap more than 2 standard errors)'}},
  pickBuckets:BUCKETS.map(b=>({bucket:label(b),...hits(picks.filter(p=>p.conf>=b[0]&&p.conf<b[1]))})).filter(x=>x.n),
  byStat:named(group(picks,p=>p.stat),10),bySide:named(group(picks,p=>p.picked),2),
  byBookConsensus:named(group(picks,bookView),3),byLineGap:named(group(picks,gapView),4),
  byGame:named(group(picks,p=>p.game+' '+String(p.lockAt).slice(0,10)),40),
  byPlayerTop:players,smallGroupNote:`Groups under ${minGroup} picks are anecdotes, not evidence.`};
}

/** Expected vs realised for settled PrizePicks entries with known payouts: E[profit] = stake*(3*p1*p2) - stake (independence assumed). */
export function expectedVsRealised(entries,legsByEntry,pickConf,settlements){
 let expected=0,realised=0,n=0;const missing=[];
 for(const e of entries){
  const s=settlements.get(Number(e.id));if(!s||s.profit_cents===null)continue;
  const legs=legsByEntry.get(Number(e.id))??[];const ps=legs.map(l=>pickConf.get(Number(l.pick_id)));
  if(ps.length!==2||ps.some(p=>p===undefined)){missing.push(Number(e.id));continue;}
  expected+=Number(e.stake_cents)*(3*ps[0]*ps[1])-Number(e.stake_cents);realised+=Number(s.profit_cents);n++;
 }
 return {entries:n,expectedProfitCents:Math.round(expected),realisedProfitCents:realised,missingProbabilities:missing,
  note:'Expected assumes the stated probabilities and independent legs; legs from the same slate can be correlated.'};
}
