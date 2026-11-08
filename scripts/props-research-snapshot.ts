/** Read-only research receipt; no provider calls, no entry RPC, no model promotion. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadPropsResearch} from '../src/lib/server/props-research-data.ts';
import {buildResearch,type ResearchArtifact} from '../src/lib/props/research.ts';

const artifact=JSON.parse(readFileSync(new URL('../src/data/props/research_v2.json',import.meta.url),'utf8')) as ResearchArtifact;
const model=readFileSync(new URL('../src/data/props/model_v1.json',import.meta.url));
if(createHash('sha256').update(model).digest('hex')!==artifact.baselineArtifactSha256)throw new Error('RESEARCH_BASELINE_ARTIFACT_CHANGED');
try{
 const view=buildResearch(await loadPropsResearch(),artifact);
 const path=process.env.PROPS_RESEARCH_OUTPUT??'artifacts/props-research';mkdirSync(path,{recursive:true});
 writeFileSync(path+'/snapshot.json',JSON.stringify(view,null,2)+'\n');
 const message={status:'READ_ONLY_RESEARCH_RECORDED',asOf:view.asOf,activeModel:view.activeVersion,candidate:view.candidateVersion,
  gradedUniqueLines:view.baseline.n,dates:view.progress.dates,games:view.progress.games,pending:view.progress.pending,
  baselineBrier:view.baseline.brier,candidateBrier:view.candidate.brier,review:view.review.status,
  availableBaselinePicks:view.rankings.baseline.length,availableCandidatePicks:view.rankings.candidate.length,
  providerCalls:0,ledgerWrites:0,promotionEnabled:false};
 console.log(JSON.stringify(message));
 if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,
  '## NBA props research\n\n```json\n'+JSON.stringify(message,null,2)+'\n```\n\nThe snapshot contains model rankings, not new paper entries. Missing grades stay pending. Pick6 returns are unknown.\n');
}catch{
 console.error('PROPS_RESEARCH_SNAPSHOT_UNAVAILABLE: no completed receipt; no pick, payout or research result substituted.');process.exitCode=1;
}
