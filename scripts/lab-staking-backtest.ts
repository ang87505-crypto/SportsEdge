/**
 * Variable PAPER staking — retrospective development run (SHADOW ONLY; nothing here changes a live stake).
 *   node --experimental-strip-types scripts/lab-staking-backtest.ts --prior player_box_2025.csv --season player_box_2026.csv \
 *     --current player_box_2027.csv --out research/lab_staking_20261112
 * Entries are built ONCE per date with the live entry builder (buildEntries: 2 legs, different games and players, at most 3 a day)
 * from the live pick rule (props-select-v1) on layer-1 forecasts, then every sizing method sizes those SAME entries.
 * Calibration uses only picks dated before the entries it sizes. PROXY lines and the recorded PrizePicks 2-pick Power table:
 * these are simulated research outcomes, never a record of real lines, entries or returns.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {decidePick,buildEntries,legResult,type EntryCandidate} from '../src/lib/props/rules.ts';
import type {ModelParams} from '../src/lib/props/model.ts';
import {loadBoxCsv,priors,fitDispersion,MODEL_FIXED} from './lib/box-csv.ts';
import {labItems,type LabHistoryItem} from './lib/lab-history.ts';
import {calibrationBins,compareStaking,stakingVerdict,STAKING_POLICY_V1,STAKING_POLICY_SHA256,type SettledEntry,type CalibrationBin} from '../src/lib/lab/staking.ts';

const arg=(n:string)=>{const i=process.argv.indexOf('--'+n);if(i<0)throw new Error('missing --'+n);return process.argv[i+1];};
const protocol=JSON.parse(readFileSync(new URL('../research/props_calibration_20261108/protocol.json',import.meta.url),'utf8'));
const pinned=(p:string)=>{const f=loadBoxCsv(p);if(protocol.sourceHashes[f.file!]!==f.sha256)throw new Error('SOURCE_HASH_MISMATCH '+f.file);return f;};
const prior=pinned(arg('prior')),season=pinned(arg('season')),current=loadBoxCsv(arg('current'));
const model=JSON.parse(readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url),'utf8'));

type Pick={item:LabHistoryItem;side:'more'|'less';probability:number;correct:boolean};
const picksOf=(items:LabHistoryItem[]):Pick[]=>items.flatMap(x=>{const d=decidePick({status:'scored',...x.base});
 return d.status==='recorded'?[{item:x,side:d.side,probability:d.probability,correct:(x.y===1)===(d.side==='more')}]:[];});
function entriesOf(picks:Pick[]):SettledEntry[]{
 const byDate=new Map<string,Pick[]>();for(const p of picks)byDate.set(p.item.date,[...(byDate.get(p.item.date)??[]),p]);
 const out:SettledEntry[]=[];
 for(const [date,ps] of [...byDate.entries()].sort()){
  const cands:EntryCandidate[]=ps.map((p,i)=>({pickId:i,platform:'prizepicks',eventId:p.item.eventId,playerKey:p.item.key.split('|')[1],teamAbbr:p.item.team,
   probability:p.probability,lockAt:p.item.at}));
  const first=Math.min(...ps.map(p=>Date.parse(p.item.at)));
  for(const legs of buildEntries(cands,{platform:'prizepicks',picksPerEntry:2,maxEntries:3,nowIso:new Date(first-3600_000).toISOString(),lockBufferMs:0})){
   const ls=legs.map(l=>ps[l.pickId]);
   out.push({id:date+':'+ls.map(l=>l.item.key).join('+'),date,platform:'prizepicks',legs:ls.map(l=>({probability:l.probability,eventId:l.item.eventId,playerKey:l.item.key.split('|')[1]})),
    legResults:ls.map(l=>legResult(l.side,l.item.y===1?'more':'less'))});
  }
 }
 return out;
}
const reliability=(ps:Pick[],bins:CalibrationBin[])=>bins.map(b=>{const x=ps.filter(p=>p.probability>=b.from&&p.probability<=b.to&&(p.probability<b.to||b.to===0.8));
 return {band:`${b.from.toFixed(2)}-${b.to.toFixed(2)}`,n:x.length,meanStated:x.length?+(x.reduce((a,p)=>a+p.probability,0)/x.length).toFixed(4):null,
  hitRate:x.length?+(x.filter(p=>p.correct).length/x.length).toFixed(4):null};});

const pr24=priors(prior.rows);
const SPLIT='2026-01-01T00:00:00.000Z';
const p1:ModelParams={...MODEL_FIXED,leagueRate:pr24.leagueRate,dispersion:fitDispersion(season.rows,pr24,Date.parse('2025-12-31T23:59:59Z'))};
const items1=labItems(season.rows,p1,a=>pr24.players.get(a)??null).items;
const picks1=picksOf(items1),train1=picks1.filter(p=>p.item.at<SPLIT),test1=picks1.filter(p=>p.item.at>=SPLIT);
const bins1=calibrationBins(train1);
const fold1=compareStaking(entriesOf(test1),bins1);

const pAll:ModelParams={...MODEL_FIXED,leagueRate:pr24.leagueRate,dispersion:fitDispersion(season.rows,pr24,Date.parse('2100-01-01T00:00:00Z'))};
const picksAll=picksOf(labItems(season.rows,pAll,a=>pr24.players.get(a)??null).items);
const binsAll=calibrationBins(picksAll);
const items2=labItems(current.rows,model.params as ModelParams,a=>model.players[a]??null).items;
const picks2=picksOf(items2);
const fold2=compareStaking(entriesOf(picks2),binsAll);

const strip=(c:ReturnType<typeof compareStaking>)=>({...c,perEntry:c.perEntry.slice(-30)});
const report={generatedBy:'scripts/lab-staking-backtest.ts',policy:STAKING_POLICY_V1,policySha256:STAKING_POLICY_SHA256,evidence:'retrospective',
 caveats:['PROXY lines (floor of last-10 median + 0.5) and the recorded PrizePicks 2-pick Power table: simulated research outcomes, not real entries or returns.',
  'No voids occur in this history (only played games with half-point proxy lines), so refunds and reverted payouts are absent.',
  'Calibration bins come only from picks dated before the entries they size.',
  'A method is never called better than flat from this run; forward settled entries are required (STAKING_GATE).',
  'Forward shadow stakes calibrate on REAL graded production picks only (never these proxy-line bins), so thin real evidence sizes dynamic methods at $0.'],
 sources:[prior,season,current].map(f=>({file:f.file,sha256:f.sha256})),
 folds:[{label:'fold1-2025-26-second-half',calibrationFrom:'2025-26 picks before 2026-01-01',calibration:bins1,
   reliabilityOutOfSample:reliability(test1,bins1),comparison:strip(fold1),verdicts:stakingVerdict(fold1,'retrospective')},
  {label:'fold2-2026-27-to-date',calibrationFrom:'all 2025-26 picks',calibration:binsAll,reliabilityOutOfSample:reliability(picks2,binsAll),
   comparison:strip(fold2),verdicts:stakingVerdict(fold2,'retrospective')}]};
mkdirSync(arg('out'),{recursive:true});
writeFileSync(arg('out')+'/report.json',JSON.stringify(report,null,1)+'\n');
for(const f of report.folds){
 console.log('\n'+f.label,'entries',f.comparison.entries,'dates',f.comparison.dates);
 console.log(' calibration out-of-sample',JSON.stringify(f.reliabilityOutOfSample));
 for(const m of f.comparison.methods)console.log(' ',m.method.padEnd(15),'staked',m.staked,'skipped',m.skipped,'pnl$',(m.pnlCents/100).toFixed(2),'roi',m.roi,'maxDD',m.maxDrawdown,'maxExp$',m.maxDailyExposureCents/100,'vol$',(m.dailyVolatilityCents/100).toFixed(2));
 console.log('  vsFlat',JSON.stringify(f.comparison.vsFlat));
 console.log('  verdicts',JSON.stringify(f.verdicts));
 console.log('  sensitivity',JSON.stringify(f.comparison.sensitivity.map(s=>({shift:s.shift,m:s.methods.map(x=>x.method+':'+(x.expectedPnlCents/100).toFixed(0)+'/'+x.probabilityOfLoss)}))));
}
