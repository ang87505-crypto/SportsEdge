/**
 * AI Learning Lab registry: versioned features, predictive layers, bounded model families and frozen
 * experiment specifications, shared by the sports and stock adapters. Pure; no LLM or external service.
 *
 * A spec is FROZEN by hashing its canonical JSON. Any later change to a frozen spec (a variant, a
 * threshold, a date) changes the hash, and verifySpec refuses it, so results are always attributable
 * to exactly one pre-registered design.
 */
import {canonicalJson,sha256} from '../props/normalize.ts';

export type LabDomain='sports'|'stocks';
/** historical: present in the pinned history AND before each forward lock. forward_only: only captured live.
 *  unavailable: no lawful, reliable, timestamped pre-event source is collected yet (never imputed). */
export type Availability='historical_and_forward'|'forward_only'|'unavailable';
export type FeatureDef={id:string;version:string;domain:LabDomain;layer:string;description:string;source:string;
 /** How the value is bounded in time: always strictly before the lock/decision time. */
 timestampRule:string;availability:Availability;dependsOn:string[];
 /** Index in the props learning feature vector (src/lib/props/learn.ts FEATURES), when it has one. */
 learnIndex?:number};
export type LayerDef={id:string;domain:LabDomain;label:string;description:string;features:string[];
 /** How the layer enters a variant: a learned weight block, a base-model swap, or a fixed pre-registered rule. */
 mechanism:'learned_weights'|'base_swap'|'fixed_rule'|'signal_overlay'};
export type ModelFamily={id:string;domain:LabDomain;description:string;hyperparameters:Record<string,(number|string)[]>};

export type VariantDef={id:string;label:string;layers:string[];role:'base'|'single_layer'|'combined'|'leave_one_out'};
export type ExperimentSpec={id:string;domain:LabDomain;registeredAt:string;hypothesis:string;
 modelFamily:string;layers:string[];unsupportedLayers:{id:string;reason:string}[];variants:VariantDef[];
 /** Untouched forward data starts here; nothing at or after it is ever used for training. */
 forwardStartsAt:string;trainingData:{description:string;through:string;sources:{file:string;sha256:string}[]};
 metrics:{primary:'brier';secondary:string[]};
 gate:{minGradedLines:number;minDates:number;minGames:number;minCandidateDecisions:number;maxBrierDifferenceUpper95:number;
  requireNoWorseLogLoss:boolean;multipleTesting:'holm';familyAlpha:number;bootstrapReplicates:number;bootstrapSeed:number};
 limits:{maxVariants:number;productionShadowLimit:number;paidRequestsPerVariant:0};
 /** Research only: the lab never changes picks, entries, thresholds or the active model. */
 researchOnly:true};

// ---------------------------------------------------------------- sports registry
export const SPORTS_FEATURES:FeatureDef[]=[
 {id:'stats_logit',version:'props-nb-minutes-rate-v1',domain:'sports',layer:'base',description:'Layer-1 negative-binomial minutes×rate probability (log-odds of More, ties excluded)',
  source:'ESPN box scores (props_player_games) + model_v1 priors',timestampRule:'games that started before the line was captured',availability:'historical_and_forward',dependsOn:[],learnIndex:1},
 {id:'bias',version:'v1',domain:'sports',layer:'recalibration',description:'Per-stat intercept refit on training data',source:'derived',timestampRule:'training rows only',
  availability:'historical_and_forward',dependsOn:['stats_logit'],learnIndex:0},
 {id:'role_minutes',version:'props-nb-role-minutes-v1',domain:'sports',layer:'role_minutes',description:'Expected minutes switch to the last-3 mean after a sustained 6+ minute role change',
  source:'ESPN box scores',timestampRule:'games that started before the line was captured',availability:'historical_and_forward',dependsOn:['stats_logit']},
 {id:'opp_allowed_ratio',version:'v1',domain:'sports',layer:'matchup_rest',description:'Opponent per-minute stat allowed vs league, last 15 opponent games',source:'ESPN box scores',
  timestampRule:'games that started before the line was captured',availability:'historical_and_forward',dependsOn:[],learnIndex:5},
 {id:'home',version:'v1',domain:'sports',layer:'matchup_rest',description:'Home team indicator',source:'schedule',timestampRule:'known before lock',availability:'historical_and_forward',dependsOn:[],learnIndex:6},
 {id:'rest_days',version:'v1',domain:'sports',layer:'matchup_rest',description:'Team rest days (capped at 3)',source:'ESPN box scores',timestampRule:'previous team game before lock',
  availability:'historical_and_forward',dependsOn:[],learnIndex:7},
 {id:'back_to_back',version:'v1',domain:'sports',layer:'matchup_rest',description:'Second night of a back-to-back',source:'ESPN box scores',timestampRule:'previous team game before lock',
  availability:'historical_and_forward',dependsOn:['rest_days'],learnIndex:8},
 {id:'books_p_more',version:'props-market-v1',domain:'sports',layer:'market',description:'No-vig sportsbook probability of More at the same line',
  source:'The Odds API quotes captured in the SAME paid request as the DFS line (no extra requests)',timestampRule:'quote captured before lock',availability:'forward_only',dependsOn:[],learnIndex:2},
 {id:'injury_status',version:'none',domain:'sports',layer:'injury_rotation',description:'Official pre-game injury/rotation status',
  source:'NOT COLLECTED: no reliable, timestamped pre-lock injury feed is stored yet',timestampRule:'n/a',availability:'unavailable',dependsOn:[]},
];
export const SPORTS_LAYERS:LayerDef[]=[
 {id:'recalibration',domain:'sports',label:'Recalibration',description:'Refit intercept and slope on the stats model log-odds',features:['bias','stats_logit'],mechanism:'learned_weights'},
 {id:'role_minutes',domain:'sports',label:'Role / minutes',description:'Role-change minutes rule inside the stats model',features:['role_minutes'],mechanism:'base_swap'},
 {id:'matchup_rest',domain:'sports',label:'Matchup, rest & opponent',description:'Opponent allowed rate, home, rest days, back-to-back',
  features:['opp_allowed_ratio','home','rest_days','back_to_back'],mechanism:'learned_weights'},
 {id:'market',domain:'sports',label:'Sportsbook market',description:'Pre-registered 50/50 log-odds blend with the no-vig sportsbook probability when books quote the same line',
  features:['books_p_more'],mechanism:'fixed_rule'},
 {id:'injury_rotation',domain:'sports',label:'Injury / rotation',description:'Official injury and rotation news before lock',features:['injury_status'],mechanism:'learned_weights'},
];
export const SPORTS_FAMILY:ModelFamily={id:'ridge-logistic-v1',domain:'sports',description:'Per-stat L2 logistic regression on a fixed feature subset (src/lib/props/learn.ts); lambda by forward-chaining validation',
 hyperparameters:{lambda:[0.01,0.1,1,10]}};

// ---------------------------------------------------------------- variant generation
/**
 * The bounded ablation set: the base model; base + recalibration; base + recalibration + each other layer;
 * the combined model; and the combined model with each layer removed. Layers without data are never run.
 * Duplicate layer sets collapse to one variant, and the set is capped so the multiple-testing family stays small.
 * `anchor` layers (the recalibration that every learned variant needs) are kept in every learned variant.
 */
export function ablationVariants(layers:string[],supported:Set<string>,anchor:string|null,maxVariants:number):VariantDef[]{
 const use=layers.filter(l=>supported.has(l));
 const others=use.filter(l=>l!==anchor);
 const withAnchor=(xs:string[])=>anchor&&supported.has(anchor)?[anchor,...xs.filter(x=>x!==anchor)]:xs;
 const candidates:VariantDef[]=[{id:'base',label:'Base model',layers:[],role:'base'}];
 if(anchor&&supported.has(anchor))candidates.push({id:'base+'+anchor,label:'Base + '+anchor,layers:[anchor],role:'single_layer'});
 for(const l of others)candidates.push({id:'base+'+(anchor&&supported.has(anchor)?anchor+'+':'')+l,label:'Base + '+l,layers:withAnchor([l]),role:'single_layer'});
 candidates.push({id:'combined',label:'Combined',layers:withAnchor(others),role:'combined'});
 for(const l of others)candidates.push({id:'combined-'+l,label:'Combined without '+l,layers:withAnchor(others.filter(x=>x!==l)),role:'leave_one_out'});
 const seen=new Map<string,VariantDef>();
 for(const v of candidates){const key=[...v.layers].sort().join(',');if(!seen.has(key))seen.set(key,v);}
 const out=[...seen.values()];
 if(out.length>maxVariants)throw new Error('LAB_TOO_MANY_VARIANTS');
 return out;
}
/** The variant whose layer set equals `layers` (order-insensitive), if the experiment ran one. */
export function variantFor(variants:VariantDef[],layers:string[]):VariantDef|null{
 const key=[...layers].sort().join(',');
 return variants.find(v=>[...v.layers].sort().join(',')===key)??null;
}

/**
 * The same frozen design evaluated where some layers have no data (e.g. no sportsbook history): variants using
 * those layers are dropped and the largest remaining leave-one-out variant stands in as "combined". Never adds anything.
 */
export function restrictSpec(spec:ExperimentSpec,missing:{id:string;reason:string}[]):ExperimentSpec{
 const drop=new Set(missing.map(m=>m.id));
 const variants=spec.variants.filter(v=>!v.layers.some(l=>drop.has(l)));
 if(!variants.some(v=>v.role==='combined')){
  const best=[...variants].filter(v=>v.role==='leave_one_out').sort((a,b)=>b.layers.length-a.layers.length)[0];
  if(best)variants.splice(variants.indexOf(best),1,{...best,role:'combined',label:'Combined (available layers)'});
 }
 return {...spec,variants,unsupportedLayers:[...spec.unsupportedLayers,...missing.filter(m=>!spec.unsupportedLayers.some(u=>u.id===m.id))]};
}

// ---------------------------------------------------------------- freezing
export function specSha256(spec:ExperimentSpec):string{return sha256(canonicalJson(spec));}
export type FrozenSpec={spec:ExperimentSpec;sha256:string};
export function freezeSpec(spec:ExperimentSpec):FrozenSpec{
 validateSpec(spec);
 return {spec,sha256:specSha256(spec)};
}
export function verifySpec(f:FrozenSpec):boolean{
 try{validateSpec(f.spec);}catch{return false;}
 return specSha256(f.spec)===f.sha256;
}
function validateSpec(s:ExperimentSpec){
 if(s.researchOnly!==true)throw new Error('LAB_SPEC_NOT_RESEARCH_ONLY');
 if(s.limits.paidRequestsPerVariant!==0)throw new Error('LAB_SPEC_PAID_REQUESTS');
 if(!s.variants.length||s.variants.length>s.limits.maxVariants)throw new Error('LAB_SPEC_VARIANTS');
 if(new Set(s.variants.map(v=>v.id)).size!==s.variants.length)throw new Error('LAB_SPEC_DUPLICATE_VARIANT');
 if(!(Date.parse(s.trainingData.through)<Date.parse(s.forwardStartsAt)))throw new Error('LAB_SPEC_TRAINING_OVERLAPS_FORWARD');
 for(const v of s.variants)for(const l of v.layers)if(!s.layers.includes(l))throw new Error('LAB_SPEC_UNKNOWN_LAYER');
 if(s.unsupportedLayers.some(u=>s.variants.some(v=>v.layers.includes(u.id))))throw new Error('LAB_SPEC_UNSUPPORTED_LAYER_USED');
}

/** Features a layer needs, transitively through dependsOn, so a layer can never silently use another layer's inputs. */
export function featureClosure(features:FeatureDef[],ids:string[]):string[]{
 const byId=new Map(features.map(f=>[f.id,f])),out=new Set<string>();
 const visit=(id:string)=>{if(out.has(id))return;const f=byId.get(id);if(!f)throw new Error('LAB_UNKNOWN_FEATURE:'+id);out.add(id);f.dependsOn.forEach(visit);};
 ids.forEach(visit);
 return [...out].sort();
}
