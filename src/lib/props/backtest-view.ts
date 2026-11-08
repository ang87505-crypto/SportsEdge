/**
 * Historical check view for the props dashboard (pure). Source: frozen summary
 * src/data/props/backtest_v1.json built from research/props_backtest_20261107.
 * Proxy lines only (recent median + 0.5), so this measures probability quality
 * and pick calibration, never profit against PrizePicks or Pick6 lines.
 */
import type {Stat} from './contract.ts';
export type RawBin={bin:number;n:number;meanPredicted:number;observedMore:number};
export type BacktestSummary={modelVersion:string;selectionVersion:string;seasons:{label:string;priorFile:string;scoredLines:number;
 brier:Record<'model'|'seasonMeanPoisson'|'last10Poisson',Record<Stat,number>>;reliability:Record<Stat,RawBin[]>;
 selection:{recorded:{n:number;hitRate:number|null};qualifyingShare:number;byBand:Record<string,{n:number;hitRate:number|null}>;
  skipped:Record<string,{n:number;hitRate:number|null}>;breakEven:number};
 monthly:{month:string;lines:number;modelBrier:number|null;last10Brier:number|null;picks:{n:number;hitRate:number|null}}[]}[]};

/** Wilson 95% interval for an observed proportion. */
export function wilson(p:number,n:number):[number,number]{
 if(n<=0)return [0,1];
 const z=1.96,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [Math.max(0,c-h),Math.min(1,c+h)];
}
/** Reliability bins in the shape CalibrationChart expects (bins with fewer than 30 lines are dropped). */
export function calibrationBins(bins:RawBin[]){
 return bins.filter(b=>b.n>=30).map(b=>({lower_bound:b.bin/10,upper_bound:(b.bin+1)/10,sample_size:b.n,
  mean_probability:b.meanPredicted,observed_frequency:b.observedMore,observed_frequency_wilson_95:wilson(b.observedMore,b.n)}));
}
/** Improvement of the model's Brier score over the better simple baseline (positive = model better). */
export function brierEdge(b:BacktestSummary['seasons'][number]['brier'],s:Stat){
 return Math.min(b.seasonMeanPoisson[s],b.last10Poisson[s])-b.model[s];
}
