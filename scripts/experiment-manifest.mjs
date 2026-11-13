// Experiment manifest (read-only): a reproducible record of what each ACTIVE forward experiment is frozen to, and a
// verifier for the Sunday freeze. It hashes the exact files that decide predictions, selection, staking, risk and
// settlement, and records the reviewed constants. It never writes to a database, a provider or a broker, and it
// changes no setting. Usage:
//   node --experimental-strip-types scripts/experiment-manifest.mjs snapshot [out.json]
//   node --experimental-strip-types scripts/experiment-manifest.mjs verify <manifest.json>   (exit 1 on any drift)
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {buildManifest,diffManifest} from './experiment-manifest-lib.mjs';

const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root));
const sha=p=>createHash('sha256').update(read(p)).digest('hex');
let commit=process.env.GITHUB_SHA??null;
try{commit??=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{commit??=null;}

const [{MODEL_VERSION,SELECTION_VERSION},{ACTIVE_BUDGET_POLICY},{REVIEW_GATE},{PRIZEPICKS_TERMS_V1},{BRAKE_WINDOW,BRAKE_MIN,BREAK_EVEN},{CAPTURE_PLAN_V1},{PAPER_AUTO_RELEASE}]=
 await Promise.all(['../src/lib/props/contract.ts','../src/lib/props/budget.ts','../src/lib/props/promotion.ts','../src/lib/props/rules.ts',
  '../src/lib/props/brake.ts','../src/lib/props/capture-plan.ts','../src/lib/stocks/paper-auto-release.ts'].map(p=>import(p)));

const manifest=buildManifest({sha,read,commit,now:new Date().toISOString(),constants:{MODEL_VERSION,SELECTION_VERSION,ACTIVE_BUDGET_POLICY,REVIEW_GATE,
 PRIZEPICKS_TERMS_V1,BRAKE:{window:BRAKE_WINDOW,min:BRAKE_MIN,breakEven:BREAK_EVEN},CAPTURE_PLAN_V1,PAPER_AUTO_RELEASE}});

const [mode,file]=process.argv.slice(2);
if(mode==='snapshot'){
 const text=JSON.stringify(manifest,null,1)+'\n';
 if(file)writeFileSync(file,text);else process.stdout.write(text);
}else if(mode==='verify'&&file){
 const frozen=JSON.parse(readFileSync(file,'utf8'));
 const d=diffManifest(frozen,manifest);
 console.log(JSON.stringify({status:d.length?'DRIFT':'FROZEN_MATCH',frozenAt:frozen.generatedAt,frozenCommit:frozen.gitCommit,currentCommit:manifest.gitCommit,drift:d}));
 if(d.length)process.exitCode=1;
}else{console.error('usage: snapshot [out.json] | verify <manifest.json>');process.exitCode=2;}
