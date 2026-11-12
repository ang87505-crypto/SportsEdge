/**
 * Model-comparison report for a frozen ablation experiment. Pure. Every variant is scored on exactly the
 * same observations; comparisons are paired and cluster-resampled; p-values are Holm-adjusted across the
 * whole experiment; a layer is only called helpful when the evidence survives that adjustment AND the
 * registered sample minimums are met. Hit rate alone never decides anything.
 */
import {properScore,summarize,type Probabilities} from '../props/research.ts';
import {clusteredDifference,holm,calibration,round,type PairedInterval} from './stats.ts';
import {variantFor,type ExperimentSpec,type VariantDef} from './registry.ts';

export type LabRow={key:string;cluster:string;date:string;stat:string;outcome:'more'|'less'|'tie';preds:Record<string,Probabilities>};
export type Comparison={candidate:string;reference:string;kind:'vs_base'|'layer_added'|'layer_removed';layer:string|null;
 brier:PairedInterval|null;logLoss:PairedInterval|null;pAdjusted:number|null};
export type LayerVerdict='helps'|'hurts'|'no_clear_effect'|'collecting'|'not_tested';
export type LayerContribution={layer:string;added:Comparison|null;removed:Comparison|null;verdict:LayerVerdict;explanation:string};
export type VariantSummary={id:string;label:string;layers:string[];n:number;brier:number|null;logLoss:number|null;hitRate:number|null;
 decisions:number;decisionHitRate:number|null;ece:number|null;reliability:{from:number;n:number;meanConfidence:number;hitRate:number}[]};
export type ComparisonReport={experimentId:string;evidence:'retrospective'|'forward';n:number;dates:number;clusters:number;
 sampleMinimumsMet:boolean;variants:VariantSummary[];comparisons:Comparison[];layers:LayerContribution[];
 familySize:number;familyAlpha:number;notes:string[]};

const binaryP=(p:Probabilities)=>p.pTie<1?p.pMore/(1-p.pTie):0.5;

export function compareVariants(spec:ExperimentSpec,rows:LabRow[],evidence:'retrospective'|'forward'):ComparisonReport{
 // One observation per key; the first wins (duplicates across platforms are one event in the world).
 const unique=[...new Map(rows.map(r=>[r.key,r])).values()].filter(r=>spec.variants.every(v=>r.preds[v.id]));
 const g=spec.gate;
 const summaries:VariantSummary[]=spec.variants.map(v=>{
  const s=summarize(unique.map(r=>({p:r.preds[v.id],outcome:r.outcome})));
  const directional=unique.filter(r=>r.outcome!=='tie');
  const cal=calibration(directional.map(r=>({p:binaryP(r.preds[v.id]),y:r.outcome==='more'?1:0})));
  return {id:v.id,label:v.label,layers:v.layers,n:s.n,brier:round(s.brier,6),logLoss:round(s.logLoss,6),hitRate:round(s.hitRate,5),
   decisions:s.decisions,decisionHitRate:round(s.decisionHitRate,5),ece:round(cal.ece,5),
   reliability:s.reliability.map(b=>({from:round(b.from,2)!,n:b.n,meanConfidence:round(b.meanConfidence,4)!,hitRate:round(b.hitRate,4)!}))};
 });
 const dates=new Set(unique.map(r=>r.date)).size,clusters=new Set(unique.map(r=>r.cluster)).size;
 const base=spec.variants.find(v=>v.role==='base')!;
 const combined=spec.variants.find(v=>v.role==='combined')??null;
 const anchorLayers=spec.variants.find(v=>v.role==='single_layer'&&v.layers.length===1)?.layers??[];
 const pair=(c:VariantDef,r:VariantDef,kind:Comparison['kind'],layer:string|null):Comparison=>{
  const loss=(f:'brier'|'logLoss')=>clusteredDifference(unique.map(x=>({cluster:x.cluster,
   candidate:properScore(x.preds[c.id],x.outcome)[f],reference:properScore(x.preds[r.id],x.outcome)[f]})),g.bootstrapReplicates,g.bootstrapSeed);
  return {candidate:c.id,reference:r.id,kind,layer,brier:loss('brier'),logLoss:loss('logLoss'),pAdjusted:null};
 };
 const comparisons:Comparison[]=[];
 for(const v of spec.variants)if(v.id!==base.id)comparisons.push(pair(v,base,'vs_base',null));
 const layerOf=new Map<string,{added:Comparison|null;removed:Comparison|null}>();
 for(const layer of spec.layers){
  if(spec.unsupportedLayers.some(u=>u.id===layer))continue;
  const withL=variantFor(spec.variants,layer===anchorLayers[0]?[layer]:[...anchorLayers,layer]);
  const without=layer===anchorLayers[0]?base:variantFor(spec.variants,anchorLayers);
  const added=withL&&without&&withL.id!==without.id?pair(withL,without,'layer_added',layer):null;
  let removed:Comparison|null=null;
  if(combined&&combined.layers.includes(layer)){
   const minus=variantFor(spec.variants,combined.layers.filter(l=>l!==layer));
   if(minus&&minus.id!==combined.id)removed=pair(combined,minus,'layer_removed',layer);
  }
  // Leave-one-out duplicates the single-layer test when only one other layer exists; keep the family honest.
  if(added&&removed&&added.candidate===removed.candidate&&added.reference===removed.reference)removed=null;
  if(added)comparisons.push(added);
  if(removed)comparisons.push(removed);
  layerOf.set(layer,{added,removed});
 }
 const tested=comparisons.filter(c=>c.brier);
 const adjusted=holm(tested.map(c=>c.brier!.pImprove));
 tested.forEach((c,i)=>{c.pAdjusted=round(adjusted[i],6);});
 const sampleMinimumsMet=unique.length>=g.minGradedLines&&dates>=g.minDates&&clusters>=g.minGames;
 const layers:LayerContribution[]=spec.layers.map(layer=>{
  const unsupported=spec.unsupportedLayers.find(u=>u.id===layer);
  if(unsupported)return {layer,added:null,removed:null,verdict:'not_tested' as LayerVerdict,explanation:unsupported.reason};
  const {added,removed}=layerOf.get(layer)??{added:null,removed:null};
  const tests=[added,removed].filter((c):c is Comparison=>!!c&&!!c.brier);
  if(!tests.length)return {layer,added,removed,verdict:'not_tested' as LayerVerdict,explanation:'No comparable variant pair was run.'};
  if(evidence==='forward'&&!sampleMinimumsMet)return {layer,added,removed,verdict:'collecting' as LayerVerdict,
   explanation:`Forward sample below the registered minimums (${unique.length}/${g.minGradedLines} lines, ${dates}/${g.minDates} dates, ${clusters}/${g.minGames} games).`};
  const helps=tests.every(c=>c.pAdjusted!==null&&c.pAdjusted<g.familyAlpha&&c.brier!.upper95<0&&(c.logLoss?.mean??0)<=0);
  const hurts=tests.some(c=>c.brier!.lower95>0);
  const fmt=(c:Comparison)=>`${c.kind==='layer_added'?'adding':'removing from the combined model'}: Brier ${c.brier!.mean>=0?'+':''}${c.brier!.mean.toFixed(5)} `+
   `(95% CI ${c.brier!.lower95.toFixed(5)} to ${c.brier!.upper95.toFixed(5)}, Holm p=${c.pAdjusted?.toFixed(4)})`;
  // For a removal test the candidate is the combined model, so a negative difference means the layer helps.
  return {layer,added,removed,verdict:helps?'helps':hurts?'hurts':'no_clear_effect',explanation:tests.map(fmt).join('; ')};
 });
 const notes=[evidence==='retrospective'?'Retrospective evidence on pinned history with PROXY lines (not platform lines). It ranks hypotheses; it cannot promote anything.':
  'Forward evidence: predictions were frozen before lock and graded afterwards.',
  `Holm adjustment across ${tested.length} comparisons (family alpha ${g.familyAlpha}).`];
 return {experimentId:spec.id,evidence,n:unique.length,dates,clusters,sampleMinimumsMet,variants:summaries,comparisons,layers,
  familySize:tested.length,familyAlpha:g.familyAlpha,notes};
}
