/**
 * Daily PAPER forecasts and grading for knyc-multisource-emos-v1-research, append-only on the research-data branch.
 * Inputs come from one receipt-verified retrieval run (PR #226's retrieval workflow, called for a trailing window).
 * Outcomes also come from the existing live collector's CLI files. This makes no network request, uses no market
 * data and places no order.
 *
 * node --experimental-strip-types scripts/kalshi-weather-multisource-paper.ts --inputs <artifact dir> --cli-dir <unzipped CLI>
 *   --data research-data [--now ISO]
 *
 * Layout under research-data/kalshi-independent/nyc-weather/multisource-v1/:
 *   forecasts/<date>-<ANCHOR>.json   frozen at or before the anchor, never rewritten
 *   grades/<date>-<ANCHOR>.json      after the CLI report, never rewritten
 *   scorecards/<YYYY-MM-DDTHHMMZ>.json forward summary and readiness at each run
 */
import {existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {loadVerifiedArchive} from '../src/lib/prediction-markets/kalshi/weather-archive-adapter.ts';
import {verifyCentralParkCli} from '../src/lib/prediction-markets/kalshi/nws-cli.ts';
import {centralParkStandardDate} from '../src/lib/prediction-markets/kalshi/weather-model.ts';
import {ANCHORS,anchorAt,buildAnchorDays,type DailyOutcome} from '../src/lib/prediction-markets/kalshi/weather-multisource.ts';
import {freezeMultisourcePaper,gradeMultisourcePaper,verifyPaperForecast,forwardSummary,type PaperGrade} from '../src/lib/prediction-markets/kalshi/weather-multisource-paper.ts';
import {paperReadiness,forwardEngineResult} from '../src/lib/prediction-markets/kalshi/weather-multisource-readiness.ts';

const argv=process.argv,opt=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?null:argv[i+1];};
const need=(n:string)=>{const v=opt(n);if(!v)throw Error('missing --'+n);return v;};
const now=opt('now')??new Date().toISOString();
if(!Number.isFinite(Date.parse(now)))throw Error('invalid --now');
const MAX_INPUT_AGE_H=3;

// ---- verified inputs
const inDir=need('inputs'),receiptText=readFileSync(join(inDir,'receipt.json'),'utf8');
const files=readdirSync(inDir).filter(n=>/^[a-z0-9][a-z0-9.-]{0,80}$/.test(n)&&n!=='receipt.json'&&statSync(join(inDir,n)).isFile())
 .map(name=>({name,bytes:readFileSync(join(inDir,name))}));
const cliProducts:{name:string;text:string}[]=[];
(function walk(d:string){for(const n of readdirSync(d).sort()){const p=join(d,n),s=statSync(p);
 if(s.isDirectory())walk(p);else if(s.isFile()&&s.size<=200_000)cliProducts.push({name:n,text:readFileSync(p,'latin1')});}})(need('cli-dir'));
const archive=loadVerifiedArchive({receiptText,files,cliProducts});
const age=(Date.parse(now)-Date.parse(archive.retrievedAt??''))/3600e3;
const freshInputs=Number.isFinite(age)&&age>=0&&age<=MAX_INPUT_AGE_H;

// ---- outcomes: archive CLI plus the existing live collector's CLI files; a disagreement excludes the day
const root=join(need('data'),'kalshi-independent','nyc-weather'),out=join(root,'multisource-v1');
const live:DailyOutcome[]=[];
const liveDir=join(root,'cli-daily-preliminary');
if(existsSync(liveDir))for(const f of readdirSync(liveDir).filter(f=>/^\d{4}-\d{2}-\d{2}\.json$/.test(f))){
 const c=verifyCentralParkCli(JSON.parse(readFileSync(join(liveDir,f),'utf8')));
 live.push({station:archive.station,localDate:c.reportDate,observedHighF:c.observedHighF,observedAvailableAt:c.issuedAt,provenance:'NWS_CLI_PRELIMINARY_CENTRAL_PARK'});
}
const conflicts:string[]=[],merged=new Map<string,DailyOutcome>();
for(const o of [...archive.outcomes,...live]){
 const p=merged.get(o.localDate);
 if(!p){merged.set(o.localDate,o);continue;}
 if(p.observedHighF!==o.observedHighF){conflicts.push(o.localDate);continue;}
 if(Date.parse(o.observedAvailableAt)<Date.parse(p.observedAvailableAt))merged.set(o.localDate,o);
}
for(const d of new Set(conflicts))merged.delete(d);
const outcomes=[...merged.values()];

// ---- freeze due targets (strictly at or before each anchor; nothing published after `now` is used)
const write=(path:string,v:unknown)=>{mkdirSync(dirname(path),{recursive:true});
 try{writeFileSync(path,JSON.stringify(v,null,1)+'\n',{flag:'wx'});return true;}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return false;throw e;}};
const today=centralParkStandardDate(now),tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400e3).toISOString().slice(0,10);
const known=archive.forecasts.filter(f=>Date.parse(f.availableAt)<=Date.parse(now));
const seen=outcomes.filter(o=>Date.parse(o.observedAvailableAt)<=Date.parse(now));
const frozenNow:string[]=[],skipped:Record<string,string>={};
for(const anchor of ANCHORS){
 const date=anchor==='SAME_DAY'?today:tomorrow,key=`${date}-${anchor}`,path=join(out,'forecasts',key+'.json');
 if(existsSync(path)){skipped[key]='ALREADY_FROZEN';continue;}
 if(Date.parse(now)>Date.parse(anchorAt(date,anchor))){skipped[key]='ANCHOR_PASSED';continue;}
 if(!freshInputs){skipped[key]=`INPUTS_NOT_FRESH (${Number.isFinite(age)?age.toFixed(2)+' h':'unknown'})`;continue;}
 const days=buildAnchorDays(known,seen,archive.station,anchor);
 if(!days.some(d=>d.localDate===date)){skipped[key]='NO_MEMBER_BULLETIN';continue;}
 if(write(path,freezeMultisourcePaper(days,date,anchor,now,archive.inputsDigest)))frozenNow.push(key);
}

// ---- grade every frozen forecast whose outcome is now published
const fdir=join(out,'forecasts'),gdir=join(out,'grades');
const records=existsSync(fdir)?readdirSync(fdir).filter(f=>f.endsWith('.json')).sort().map(f=>verifyPaperForecast(JSON.parse(readFileSync(join(fdir,f),'utf8')))):[];
const gradedNow:string[]=[];
for(const r of records){
 const key=`${r.localDate}-${r.anchor}`,o=seen.find(x=>x.localDate===r.localDate);
 if(r.status!=='FROZEN'||!o||existsSync(join(gdir,key+'.json')))continue;
 if(write(join(gdir,key+'.json'),gradeMultisourcePaper(r,o)))gradedNow.push(key);
}
const grades:PaperGrade[]=existsSync(gdir)?readdirSync(gdir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(gdir,f),'utf8'))):[];
const summary=forwardSummary(records,grades,now);
const latest=(a:string)=>records.filter(r=>r.anchor===a).at(-1);
const readiness=paperReadiness({verifiedInputs:true,forward:summary,
 trainingDaysByAnchor:Object.fromEntries(ANCHORS.map(a=>[a,latest(a)?.trainingDays??0]))});
const card={schema:'kalshi-weather-multisource-paper-scorecard-v1',at:now,inputsDigest:archive.inputsDigest,inputsRetrievedAt:archive.retrievedAt,
 frozenNow,gradedNow,skipped,outcomeConflicts:[...new Set(conflicts)],summary,readiness,engineResult:forwardEngineResult(summary)};
write(join(out,'scorecards',now.slice(0,16).replace(':','')+'Z.json'),card);
console.log('MULTISOURCE_PAPER_BEGIN');console.log(JSON.stringify(card));console.log('MULTISOURCE_PAPER_END');
