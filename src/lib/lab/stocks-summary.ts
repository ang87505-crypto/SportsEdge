/**
 * Stock psychology research status for the Lab view (lab-stock-psychology-v1, analytics/stock_psychology_v1.py).
 * Registered and tested on fictional prices; no historical result exists until the owner dispatches the manual
 * "Stock psychology research (lab, manual)" workflow and its report is committed. Nothing here is a result.
 */
import type {LabInput} from './view.ts';
export const STOCK_PSYCHOLOGY_LAYERS=['attention_spike','volatility_shock','short_term_overreaction'] as const;
export const STOCK_PSYCHOLOGY_UNSUPPORTED=['news_sentiment','earnings_surprise','search_attention','crowd_concentration'] as const;
export function stockLabSummary():LabInput['stocks']{return {state:'not_run'};}
