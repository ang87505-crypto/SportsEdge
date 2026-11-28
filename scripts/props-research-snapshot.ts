/** Read-only research receipt; no provider calls, no entry RPC, no model promotion. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadPropsResearch,loadForecastTraceRaw} from '../src/lib/server/props-research-data.ts';
import {traceForecasts} from '../src/lib/props/forecast-trace.ts';
import {buildResearch,evaluateGapChallenger,type ResearchArtifact,type ChallengerSpec} from '../src/lib/props/research.ts';

const artifact=JSON.parse(readFileSync(new URL('../src/data/props/research_v2.json',import.meta.url),'utf8')) as ResearchArtifact;
const gapSpec=JSON.parse(readFileSync(new URL('../src/data/props/challenger_gap_shrink_v1.json',import.meta.url),'utf8')) as ChallengerSpec;
const model=readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url));
if(createHash('sha256').update(model).digest('hex')!==artifact.baselineArtifactSha256)throw new Error('RESEARCH_BASELINE_ARTIFACT_CHANGED');
try{
 const raw=await loadPropsResearch();
 const view=buildResearch(raw,artifact);
 const gap=evaluateGapChallenger(raw,gapSpec);
 // Every model's predictions, picked or not, traced to line, confidence, model and outcome. Fails closed on its own:
 // an unreadable trace is reported as UNAVAILABLE and never replaced by the baseline-only snapshot above.
 let forecastTrace:Record<string,unknown>;
 try{const t=traceForecasts(await loadForecastTraceRaw(undefined,raw.nowIso));const {rows:_rows,...summary}=t;void _rows;forecastTrace=summary;}
 catch(e){forecastTrace={state:'UNAVAILABLE',code:e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'TRACE_READ_FAILED'};}
 const path=process.env.PROPS_RESEARCH_OUTPUT??'artifacts/props-research';mkdirSync(path,{recursive:true});
 writeFileSync(path+'/snapshot.json',JSON.stringify({...view,challengers:{[gap.version]:gap},forecastTrace},null,2)+'\n');
 const message={status:'READ_ONLY_RESEARCH_RECORDED',asOf:view.asOf,activeModel:view.activeVersion,candidate:view.candidateVersion,
  gradedUniqueLines:view.baseline.n,dates:view.progress.dates,games:view.progress.games,pending:view.progress.pending,
  baselineBrier:view.baseline.brier,candidateBrier:view.candidate.brier,review:view.review.status,
  availableBaselinePicks:view.rankings.baseline.length,availableCandidatePicks:view.rankings.candidate.length,
  gapChallenger:{version:gap.version,forwardStartsAt:gap.forwardStartsAt,graded:gap.baseline.n,games:gap.progress.games,dates:gap.progress.dates,
   baselineBrier:gap.baseline.brier,candidateBrier:gap.candidate.brier,status:gap.status},
  forecastTrace:{state:forecastTrace.state,predictions:forecastTrace.predictions??null,overdue:forecastTrace.overdue??null,
   issues:forecastTrace.issues??null,code:forecastTrace.code??null},
  providerCalls:0,ledgerWrites:0,promotionEnabled:false};
 console.log(JSON.stringify(message));
 if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,
  '## NBA props research\n\n```json\n'+JSON.stringify(message,null,2)+'\n```\n\nThe snapshot contains model rankings, not new paper entries. Missing grades stay pending. Pick6 returns are unknown.\n');
}catch{
 console.error('PROPS_RESEARCH_SNAPSHOT_UNAVAILABLE: no completed receipt; no pick, payout or research result substituted.');process.exitCode=1;
}
