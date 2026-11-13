/**
 * AI Learning Lab read model: one pure view shared by the Learning Lab page, the homepage strip and Ask SportsEdge.
 * Every number comes from a stored report or ledger row; anything missing is reported as missing, never as zero.
 * Retrospective (proxy-line history) and forward (frozen before lock, graded after) evidence are always kept apart.
 */
import type {ComparisonReport,LayerVerdict} from './compare.ts';
import type {FlagEffect} from './sports/risk.ts';
import type {MistakeReport} from './sports/attribution.ts';
import {RISK_TEXT} from './sports/risk.ts';
import {SPORTS_LAYERS} from './registry.ts';
import {SPORTS_ABLATION_SPEC} from './sports/spec.ts';
import {METHOD_TEXT,STAKING_GATE,type Method} from './staking.ts';
import {round} from './stats.ts';

export type RetroFold={label:string;train:{rows:number;from:string|null;to:string};test:{rows:number;from:string;to:string};comparison:ComparisonReport;
 riskFlags:{selectedPicks:number;effects:FlagEffect[];coverageGaps:string[]};mistakes:MistakeReport};
export type RetroReport={experimentId:string;specSha256:string;artifactSha256:string;caveats:string[];leakage:{checked:number;violations:number};folds:RetroFold[];runtimeSeconds?:number};
export type StakingMethodRow={method:Method;staked:number;skipped:number;pnlCents:number;roi:number|null;maxDrawdown:number|null;maxDailyExposureCents:number;dailyVolatilityCents:number|null};
export type RetroStaking={caveats:string[];folds:{label:string;comparison:{entries:number;dates:number;methods:StakingMethodRow[];
 sensitivity:{shift:number;methods:{method:Method;expectedPnlCents:number;probabilityOfLoss:number}[]}[]};
 reliabilityOutOfSample:{band:string;n:number;meanStated:number|null;hitRate:number|null}[];verdicts:{method:Method;verdict:string}[]}[]};
export type ForwardReport={asOf:string;progress:{frozenLines:number;graded:number;pending:number;voided:number};comparison:ComparisonReport;
 riskFlags:{selectedPicks:number;effects:FlagEffect[]};mistakes:MistakeReport};
export type ForwardStaking={asOf:string;entries:number;settled:number;pending:number;payoutUnknown:number;dates:number;
 methods:StakingMethodRow[];verdicts:{method:Method;verdict:string;meanProfitDifferenceCents:number|null;pAdjusted:number|null}[]};
export type LabEvent={event:string;detail:Record<string,unknown>;at:string};
export type ProductionModel={active:string;learningEnabled:boolean;autoSwitchEnabled:boolean;shadows:string[];
 events:{version:string;event:string;reason:string;at:string;detail?:Record<string,unknown>}[]}|null;
export type LabInput={nowIso:string;retro:RetroReport;retroStaking:RetroStaking|null;
 forward:{state:'ready'|'not_migrated'|'not_configured'|'unavailable';report:ForwardReport|null;staking:ForwardStaking|null;events:LabEvent[];frozenToday?:number};
 production:ProductionModel;stocks:{state:'not_run'|'ready';summary?:string;verdicts?:{layer:string;verdict:string;label:string;detail:string|null}[];lab?:import('../research/stock-summary.ts').StockLabSummary}|null};

const LAYER_LABEL=Object.fromEntries(SPORTS_LAYERS.map(l=>[l.id,l.label]));
export const VERDICT_TEXT:Record<LayerVerdict,string>={helps:'Helps',hurts:'Hurts',no_clear_effect:'No clear effect',collecting:'Collecting forward data',not_tested:'Not tested'};
/** Known earlier experiments, from the committed research record (docs/ and research/). */
export const EARLIER_EXPERIMENTS=[
 {id:'props-cal-v1',outcome:'withdrawn',why:'Withdrawn before any run: duplicated props-temperature-v2 (research/props_cal_v1_20261110/amendment-1.json).'},
 {id:'props-nb-role-minutes-v1',outcome:'rejected',why:'As a stand-alone swap it made Brier worse (+0.00086 on 2025-26 points; docs/PROPS_CHALLENGER_ROLE_MINUTES_2026_11_10.md). The lab re-tests it as one layer inside the recalibrated model.'},
 {id:'props-gap-shrink-v1',outcome:'collecting',why:'Pre-registered prospective challenger; never promotes (docs/PROPS_CHALLENGER_GAP_SHRINK_2026_11_12.md).'},
];

export type LayerRow={layer:string;label:string;retro:{fold:string;verdict:LayerVerdict;brierChange:number|null;lower95:number|null;upper95:number|null;pAdjusted:number|null}[];
 forward:{verdict:LayerVerdict;brierChange:number|null;lower95:number|null;upper95:number|null}|null;explanation:string};
export type LabView=ReturnType<typeof buildLabView>;

function layerChange(c:ComparisonReport,layer:string){
 const l=c.layers.find(x=>x.layer===layer);
 const t=l?.added??l?.removed??null;
 return {verdict:(l?.verdict??'not_tested') as LayerVerdict,brierChange:round(t?.brier?.mean??null,5),lower95:round(t?.brier?.lower95??null,5),
  upper95:round(t?.brier?.upper95??null,5),pAdjusted:t?.pAdjusted??null,explanation:l?.explanation??''};
}

export function buildLabView(x:LabInput){
 const folds=x.retro.folds;
 const layers:LayerRow[]=SPORTS_LAYERS.map(l=>({layer:l.id,label:l.label,
  retro:folds.map(f=>({fold:f.label,...layerChange(f.comparison,l.id)})),
  forward:x.forward.report?layerChange(x.forward.report.comparison,l.id):null,
  explanation:folds[0]?layerChange(folds[0].comparison,l.id).explanation:''}));
 const fr=x.forward.report;
 const g=fr?.comparison;
 const fwdStatus=x.forward.state!=='ready'?x.forward.state:!fr?'awaiting_first_report':g!.sampleMinimumsMet?'sample_minimums_met':'collecting';
 const minimums={lines:500,dates:14,games:50};
 const variants=(c:ComparisonReport)=>c.variants.map(v=>({id:v.id,label:v.label,n:v.n,brier:v.brier,logLoss:v.logLoss,ece:v.ece,decisions:v.decisions,decisionHitRate:v.decisionHitRate}));
 const bestFold=folds[0];
 const flags=(fr&&fr.riskFlags.selectedPicks>=30?fr.riskFlags:bestFold?.riskFlags)??null;
 const mistakes=(fr&&fr.mistakes.picks>=30?fr.mistakes:bestFold?.mistakes)??null;
 const lastEvent=(e:string)=>x.forward.events.filter(v=>v.event===e).sort((a,b)=>b.at.localeCompare(a.at))[0]??null;
 const rejectedProd=(x.production?.events??[]).filter(e=>e.event==='dropped'||e.event==='retired'||e.event==='rolled_back');
 return {
  asOf:x.nowIso,
  active:x.production?{version:x.production.active,learningEnabled:x.production.learningEnabled,autoSwitchEnabled:x.production.autoSwitchEnabled}:null,
  testing:{productionShadows:x.production?.shadows??[],labVariants:SPORTS_ABLATION_SPEC.variants.length,
   labExperiment:x.retro.experimentId,shadowLimit:3,note:'Lab variants are frozen in their own research ledger; they never count against the three production shadow slots.'},
  layers,
  samples:{retro:folds.map(f=>({fold:f.label,trainRows:f.train.rows,testRows:f.test.rows,from:f.test.from,to:f.test.to})),
   forward:fr?{graded:fr.progress.graded,pending:fr.progress.pending,frozenLines:fr.progress.frozenLines,dates:g!.dates,games:g!.clusters}:null,minimums},
  forwardStatus:fwdStatus,
  forwardVariants:g?variants(g):null,
  retroVariants:folds.map(f=>({fold:f.label,variants:variants(f.comparison)})),
  mistakes:mistakes?{source:fr&&fr.mistakes.picks>=30?'forward':'retrospective',picks:mistakes.picks,misses:mistakes.misses,hitRate:mistakes.hitRate,
   patterns:mistakes.patterns.slice(0,6).map(p=>({pattern:p.pattern,what:p.what,misses:p.misses,share:p.shareOfMisses,lift:p.lift,preLock:p.availableBeforeLock,
    feature:p.candidateFeature,signal:p.bestPreLockSignal?{flag:p.bestPreLockSignal.flag,missesAvoided:p.bestPreLockSignal.skipRule.missesAvoided,goodRejected:p.bestPreLockSignal.skipRule.goodPicksRejected}:null}))}:null,
  warnings:flags?{source:fr&&fr.riskFlags.selectedPicks>=30?'forward':'retrospective',picks:flags.selectedPicks,
   effects:flags.effects.map(e=>({flag:e.flag,text:RISK_TEXT[e.flag],flagged:e.flagged,flaggedHitRate:e.flaggedHitRate,unflaggedHitRate:e.unflaggedHitRate,
    missesAvoided:e.skipRule.missesAvoided,goodRejected:e.skipRule.goodPicksRejected,hitRateAfterSkip:e.skipRule.hitRateAfter,verdict:e.verdict}))}:null,
  coverageGaps:bestFold?.riskFlags.coverageGaps??[],
  costs:{paidRequests:0,note:'The lab reuses stored lines and sportsbook quotes: zero provider credits. Compute: one historical run (~'+(x.retro.runtimeSeconds??120)+' s) plus a few seconds per tick.'},
  history:{production:(x.production?.events??[]).slice(0,12),lab:x.forward.events.slice(0,12),earlier:EARLIER_EXPERIMENTS,rejectedProduction:rejectedProd.length},
  promotion:{eligible:false,why:fwdStatus==='sample_minimums_met'?'Forward minimums met; a layer verdict is recorded once. Promotion still goes through the props-learn shadow gate and owner review.':
   `No lab improvement meets the promotion requirements: forward evidence needs ${minimums.lines} graded lines, ${minimums.dates} dates, ${minimums.games} games and 100 decisions, a Holm-adjusted Brier improvement and no worse log loss.`},
  staking:{retro:x.retroStaking,forward:x.forward.staking,gate:STAKING_GATE,methods:METHOD_TEXT,
   live:'Live virtual entries stay at the flat $5 stake. Variable stakes are shadow research only.'},
  stocks:x.stocks,
  lastFreeze:lastEvent('freeze_run'),lastReport:lastEvent('report'),
  caveats:x.retro.caveats,leakage:x.retro.leakage,specSha256:x.retro.specSha256,artifactSha256:x.retro.artifactSha256,layerLabel:LAYER_LABEL,
 };
}
