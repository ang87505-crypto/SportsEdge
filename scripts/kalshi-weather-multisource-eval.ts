/**
 * Offline evaluation of knyc-multisource-emos-v1-research on archives retrieved by PR #226's workflow.
 * Makes no network request. Inputs are hashed and checked against #226's receipt before anything is parsed.
 *
 * node --experimental-strip-types scripts/kalshi-weather-multisource-eval.ts \
 *   --receipt dir/receipt.json --gfs dir/gfs.csv --nbs dir/nbs.csv --cli-zip dir/cli.zip --cli-dir extracted/ \
 *   --out report.json [--engine-result result.json]
 */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {join,basename} from 'node:path';
import {parseIemMosCsv,parseCliArchive,stationKey} from '../src/lib/prediction-markets/kalshi/weather-archive-adapter.ts';
import {ANCHORS,MEMBERS,buildAnchorDays,type MemberForecast} from '../src/lib/prediction-markets/kalshi/weather-multisource.ts';
import {evaluateMultisource} from '../src/lib/prediction-markets/kalshi/weather-multisource-eval.ts';
import {engineResult} from '../src/lib/prediction-markets/kalshi/weather-multisource-readiness.ts';

const argv=process.argv,opt=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?null:argv[i+1];};
const need=(n:string)=>{const v=opt(n);if(!v)throw Error('missing --'+n);return v;};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

const receipt=opt('receipt')?JSON.parse(readFileSync(opt('receipt')!,'utf8')):null;
const verified:Record<string,string>={};
function load(path:string):Buffer{
 const b=readFileSync(path),h=sha(b);
 if(receipt){const f=(receipt.files??[]).find((x:{name:string})=>x.name===basename(path));
  if(!f||f.sha256!==h)throw Error('INPUT_HASH_MISMATCH '+basename(path));}
 verified[basename(path)]=h;return b;
}
const gfs=load(need('gfs')).toString('utf8'),nbs=load(need('nbs')).toString('utf8');
if(opt('cli-zip'))load(opt('cli-zip')!);
const files:{name:string;text:string}[]=[];
(function walk(d:string){for(const n of readdirSync(d).sort()){const p=join(d,n),s=statSync(p);
 if(s.isDirectory())walk(p);else if(s.isFile()&&s.size<=200_000)files.push({name:p.slice(need('cli-dir').length+1),text:readFileSync(p,'latin1')});}})(need('cli-dir'));

const station=stationKey('KNYC');
const g=parseIemMosCsv(gfs,'GFS','KNYC'),n=parseIemMosCsv(nbs,'NBS','KNYC');
const forecasts:MemberForecast[]=[...g.forecasts,...n.forecasts].map(f=>({...f,station}));
const cli=parseCliArchive(files);
const byAnchor=ANCHORS.map(a=>buildAnchorDays(forecasts,cli.outcomes,station,a));
const report=evaluateMultisource(byAnchor);
const data={inputsSha256:verified,cliFilesRead:files.length,outcomes:cli.outcomes.length,
 outcomeRange:cli.outcomes.length?[cli.outcomes[0].localDate,cli.outcomes.at(-1)!.localDate]:null,
 forecastsByMember:Object.fromEntries(MEMBERS.map(m=>[m,forecasts.filter(f=>f.member===m).length])),
 adapterIssues:{gfs:g.issues,nbs:n.issues,cli:cli.issues},
 daysWithMember:Object.fromEntries(ANCHORS.map((a,i)=>[a,Object.fromEntries(MEMBERS.map(m=>[m,byAnchor[i].filter(d=>d.members[m]).length]))])),
 outcomeSources:cli.sources};
writeFileSync(need('out'),JSON.stringify({...report,data},null,1)+'\n');
if(opt('engine-result'))writeFileSync(opt('engine-result')!,JSON.stringify([engineResult(report)],null,1)+'\n');
const summary={modelId:report.modelId,disposition:report.disposition,data:{...data,outcomeSources:undefined},
 anchors:report.anchors.map(a=>({...a,rows:undefined}))};
console.log('MULTISOURCE_EVAL_BEGIN');console.log(JSON.stringify(summary));console.log('MULTISOURCE_EVAL_END');
