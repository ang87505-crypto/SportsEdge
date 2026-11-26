/**
 * Offline evaluation of knyc-multisource-emos-v1-research on archives retrieved by PR #226's workflow.
 * Makes no network request. Inputs are hashed and checked against #226's receipt before anything is parsed.
 * Scored target dates are bounded by the receipt's target_start/target_end (or --from/--to for older receipts).
 *
 * node --experimental-strip-types scripts/kalshi-weather-multisource-eval.ts --inputs <artifact dir> --cli-dir <unzipped CLI>
 *   --out report.json [--engine-result result.json] [--from YYYY-MM-DD --to YYYY-MM-DD] [--label name]
 */
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {loadVerifiedArchive} from '../src/lib/prediction-markets/kalshi/weather-archive-adapter.ts';
import {ANCHORS,MEMBERS,buildAnchorDays} from '../src/lib/prediction-markets/kalshi/weather-multisource.ts';
import {evaluateMultisource} from '../src/lib/prediction-markets/kalshi/weather-multisource-eval.ts';
import {engineResult} from '../src/lib/prediction-markets/kalshi/weather-multisource-readiness.ts';

const argv=process.argv,opt=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?null:argv[i+1];};
const need=(n:string)=>{const v=opt(n);if(!v)throw Error('missing --'+n);return v;};
const inDir=need('inputs'),cliDir=need('cli-dir');
const files=readdirSync(inDir).filter(n=>/^[a-z0-9][a-z0-9.-]{0,80}$/.test(n)&&n!=='receipt.json'&&statSync(join(inDir,n)).isFile())
 .map(name=>({name,bytes:readFileSync(join(inDir,name))}));
const cliProducts:{name:string;text:string}[]=[];
(function walk(d:string){for(const n of readdirSync(d).sort()){const p=join(d,n),s=statSync(p);
 if(s.isDirectory())walk(p);else if(s.isFile()&&s.size<=200_000)cliProducts.push({name:n,text:readFileSync(p,'latin1')});}})(cliDir);
const a=loadVerifiedArchive({receiptText:readFileSync(join(inDir,'receipt.json'),'utf8'),files,cliProducts});
const from=a.targetStart??opt('from'),to=a.targetEnd??opt('to');
if(!from||!to)throw Error('TARGET_RANGE_REQUIRED');
if((opt('from')&&opt('from')!==from)||(opt('to')&&opt('to')!==to))throw Error('TARGET_RANGE_DISAGREES_WITH_RECEIPT');
const inRange=(d:string)=>d>=from&&d<=to;
const forecasts=a.forecasts.filter(f=>inRange(f.targetLocalDate)),outcomes=a.outcomes.filter(o=>inRange(o.localDate));
const byAnchor=ANCHORS.map(x=>buildAnchorDays(forecasts,outcomes,a.station,x));
const report=evaluateMultisource(byAnchor);
const data={label:opt('label'),targetRange:[from,to],rangeSource:a.targetStart?'receipt':'arguments',inputsSha256:a.inputsSha256,
 cliFilesRead:cliProducts.length,outcomes:outcomes.length,outcomesOutsideRange:a.outcomes.length-outcomes.length,
 outcomeRange:outcomes.length?[outcomes[0].localDate,outcomes.at(-1)!.localDate]:null,
 forecastsByMember:Object.fromEntries(MEMBERS.map(m=>[m,forecasts.filter(f=>f.member===m).length])),
 adapterIssues:a.issues,conflictingDuplicates:a.conflicts,
 daysWithMember:Object.fromEntries(ANCHORS.map((x,i)=>[x,Object.fromEntries(MEMBERS.map(m=>[m,byAnchor[i].filter(d=>d.members[m]).length]))])),
 outcomeSources:a.outcomeSources.filter(o=>inRange(o.date))};
writeFileSync(need('out'),JSON.stringify({...report,data},null,1)+'\n');
if(opt('engine-result'))writeFileSync(opt('engine-result')!,JSON.stringify([engineResult(report)],null,1)+'\n');
const summary={modelId:report.modelId,disposition:report.disposition,data:{...data,outcomeSources:undefined},
 anchors:report.anchors.map(x=>({...x,rows:undefined}))};
console.log('MULTISOURCE_EVAL_BEGIN');console.log(JSON.stringify(summary));console.log('MULTISOURCE_EVAL_END');
