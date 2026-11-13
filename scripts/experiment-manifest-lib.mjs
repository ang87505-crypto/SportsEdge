// Pure parts of the experiment manifest: which files and constants define each active experiment, and how two
// manifests are compared. No I/O here; the caller passes `sha(path)` and `read(path)`.

/** Files whose content decides predictions, selection, entries, stakes, settlement, risk or capture timing. */
export const FROZEN_FILES={
 'props-paper-v1':[
  'src/data/props/model_v1.json','src/lib/props/model.ts','src/lib/props/features.ts','src/lib/props/contract.ts',
  'src/lib/props/rules.ts','src/lib/props/budget.ts','src/lib/props/capture-plan.ts','src/lib/props/schedule.ts',
  'src/lib/props/brake.ts','src/lib/props/promotion.ts','src/lib/props/learn.ts','src/lib/props/normalize.ts',
  'src/lib/server/props-cycle.ts','src/lib/server/props-tick.ts','src/lib/server/props-active-model.ts'],
 'stock-v2-weekly-1':[
  'config/paper-auto/stock-v2-weekly-1.json','config/paper-auto/universe-large-cap-v1.json',
  'analytics/stock_weekly_bridge_v2.py','analytics/stock_weekly_scoring_v2.py',
  'src/lib/server/paper-auto-controller.ts','src/lib/server/paper-auto-risk.ts','src/lib/server/paper-auto-broker.ts',
  'src/lib/stocks/paper-auto-release.ts'],
};

/** Research registries are recorded (not frozen): challengers may be added; they never change an active experiment. */
export const RECORDED_FILES=['config/research/registry.json','src/data/lab/sports_ablation_v1.json',
 'src/data/props/research_v2.json','src/data/props/challenger_gap_shrink_v1.json',
 // Scheduling assumptions: recorded so a schedule change is visible, but a backup-cadence change does not alter
 // what any prediction, pick or stake is, so it does not break the freeze.
 'vercel.json','src/lib/server/scheduler-kickoff.ts','.github/workflows/props-tick.yml','.github/workflows/props-daily.yml',
 '.github/workflows/paper-auto-worker.yml','.github/workflows/paper-auto-decision-weekly.yml'];

export function buildManifest({sha,read,commit,now,constants:c}){
 const files=ids=>Object.fromEntries(ids.map(p=>[p,sha(p)]));
 const stockCfg=JSON.parse(read('config/paper-auto/stock-v2-weekly-1.json').toString('utf8'));
 return {schema:'sportsedge-experiment-manifest-v1',generatedAt:now,gitCommit:commit,
  experiments:[
   {id:'props-paper-v1',status:'forward',domain:'sports',
    model:c.MODEL_VERSION,selection:c.SELECTION_VERSION,
    predictionRule:'pick when the model probability of the chosen side is within the reviewed confidence band (src/lib/props/rules.ts)',
    staking:'flat $5 virtual per 2-pick entry; at most 3 entries per platform per day; distinct games',
    payoutTerms:c.PRIZEPICKS_TERMS_V1.version,pick6Payouts:'unknown (never valued)',
    budget:{version:c.ACTIVE_BUDGET_POLICY.version,daily:c.ACTIVE_BUDGET_POLICY.dailyCredits,monthly:c.ACTIVE_BUDGET_POLICY.monthlyCredits,
     floor:c.ACTIVE_BUDGET_POLICY.providerFloor},
    capturePlan:{version:c.CAPTURE_PLAN_V1.version,windows:c.CAPTURE_PLAN_V1.windows},
    safetyBrake:c.BRAKE,promotionGate:c.REVIEW_GATE,
    dataSources:['The Odds API v4 (PrizePicks, Pick6, sportsbooks)','ESPN public box scores'],
    timestamps:'observations: provider_last_update, ingested_at, lock_at; predictions/picks refused at or after lock by the database',
    metrics:['hit rate (graded recorded picks)','Brier and log loss (all scored lines)','calibration by confidence band','virtual return under PrizePicks terms'],
    benchmark:'break-even 57.7% for a 2-pick Power Play; sportsbook consensus where quoted',
    startDate:'2026-11-07',endDate:null,
    frozenFiles:files(FROZEN_FILES['props-paper-v1'])},
   {id:'stock-v2-weekly-1',status:'paper-orders-pending-first-session',domain:'stocks',
    model:stockCfg.modelVersion??stockCfg.model_version??null,
    registration:Object.fromEntries(Object.entries(stockCfg).filter(([k])=>!/key|secret|token|account/i.test(k))),
    release:{paperOnly:c.PAPER_AUTO_RELEASE.paperOnly,brokerWritesEnabled:c.PAPER_AUTO_RELEASE.brokerWritesEnabled,
     scheduledRunsEnabled:c.PAPER_AUTO_RELEASE.scheduledRunsEnabled,realMoneyEnabled:c.PAPER_AUTO_RELEASE.realMoneyEnabled},
    dataSources:['Alpaca PAPER (IEX bars, account, orders)'],
    metrics:['verified after-close equity chain','SPY over the same marks','observed drawdown'],
    benchmark:'SPY (raw close, same marks)',
    frozenFiles:files(FROZEN_FILES['stock-v2-weekly-1'])},
  ],
  recordedFiles:files(RECORDED_FILES)};
}

/** Every difference that matters for a frozen experiment: a frozen file hash, a constant or the release flags. */
export function diffManifest(frozen,current){
 const out=[];
 const byId=new Map(current.experiments.map(e=>[e.id,e]));
 for(const e of frozen.experiments){
  const c=byId.get(e.id);
  if(!c){out.push({experiment:e.id,what:'experiment missing'});continue;}
  for(const [p,h] of Object.entries(e.frozenFiles))if(c.frozenFiles[p]!==h)out.push({experiment:e.id,what:'file',path:p,frozen:h.slice(0,12),current:(c.frozenFiles[p]??'missing').slice(0,12)});
  for(const k of Object.keys(e))if(!['frozenFiles'].includes(k)&&JSON.stringify(e[k])!==JSON.stringify(c[k]))out.push({experiment:e.id,what:'setting',key:k});
 }
 return out;
}
