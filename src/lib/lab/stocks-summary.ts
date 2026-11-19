/**
 * Stock behaviour research status for the Lab view and chat (lab-stock-psychology-v1, analytics/stock_psychology_v1.py).
 * Read from the research pipeline's published summary (research-data branch). Validated and unvalidated findings are
 * always separated; a historical "helps" is never called validated until the frozen forward ledger reaches its minimum.
 */
import type {LabInput} from './view.ts';
import type {ResearchView,StockLabSummary} from '../research/stock-summary.ts';
export const STOCK_LAB_LAYERS=['market_regime','attention_spike','volatility_shock','short_term_overreaction'] as const;
export const STOCK_LAB_UNSUPPORTED=['news_sentiment','earnings_surprise','search_attention','crowd_concentration'] as const;
const LABEL:Record<string,string>={market_regime:'Market regime (SPY vs 200-day)',attention_spike:'Attention spikes',volatility_shock:'Volatility shocks',
 short_term_overreaction:'One-month overreaction',news_sentiment:'News sentiment',earnings_surprise:'Earnings surprises',search_attention:'Search attention',
 crowd_concentration:'Crowd concentration'};
/** Short badge text per verdict code; a reason (e.g. why a layer is not tested) is returned separately so it can wrap. */
export const STOCK_VERDICT_LABEL:Record<string,string>={helps:'Helps',hurts:'Hurts',no_clear_effect:'No clear effect',not_tested:'Not tested',not_run:'Not run yet'};
export function stockVerdict(raw:string|undefined):{verdict:string;label:string;detail:string|null}{
 if(raw===undefined)return {verdict:'not_run',label:STOCK_VERDICT_LABEL.not_run,detail:null};
 const m=/^([a-z_]+)(?::\s*([\s\S]+))?$/.exec(raw.trim());
 const code=m?m[1]:'unknown',detail=m?.[2]?.trim()||null;
 return {verdict:code,label:STOCK_VERDICT_LABEL[code]??code.replaceAll('_',' '),detail};
}
const pct=(x:number|null|undefined)=>x===null||x===undefined?'—':(x*100).toFixed(1)+'%';

export function stockLabSummary(view?:ResearchView|null):LabInput['stocks']{
 const lab:StockLabSummary|null|undefined=view?.summary?.lab;
 if(!lab)return {state:'not_run'};
 const verdicts=[...STOCK_LAB_LAYERS,...STOCK_LAB_UNSUPPORTED].map(l=>({layer:LABEL[l]??l,...stockVerdict(l in lab.verdicts?lab.verdicts[l]:undefined)}));
 const fwd=Object.values(lab.forward.variants);
 const weeks=fwd.length?Math.max(...fwd.map(f=>f.weeks??0)):0;
 const base=lab.holdout.base,comb=lab.holdout.combined;
 const summary=(lab.historicalAt?`Historical ablation (${lab.historicalAt.slice(0,10)}; 2023+ holdout, 10 bps): base momentum CAGR ${pct(base?.cagr)}, Sharpe ${base?.sharpe?.toFixed(2)??'—'}; `+
  `all layers combined CAGR ${pct(comb?.cagr)}, Sharpe ${comb?.sharpe?.toFixed(2)??'—'}. `:'The historical ablation has not run yet. ')+
  `Forward frozen picks: ${lab.forward.frozenRows} rows from ${lab.forward.firstDecision}, ${weeks} graded week(s) of ${lab.forward.minWeeks} needed. `+
  `Validated findings: ${lab.validated.length?lab.validated.map(x=>LABEL[x.layer]??x.layer).join(', '):'none'}. Unvalidated: ${lab.unvalidated.map(x=>`${LABEL[x.layer]??x.layer} (${x.historical.replaceAll('_',' ')})`).join(', ')}.`;
 return {state:'ready',summary,verdicts,lab};
}
