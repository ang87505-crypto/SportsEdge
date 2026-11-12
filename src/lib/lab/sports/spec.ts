/**
 * lab-sports-ablation-v1: the frozen, pre-registered sports ablation experiment. Changing anything here
 * changes the spec hash; the registry and the forward ledger then refuse to mix it with earlier results.
 */
import {REVIEW_GATE} from '../../props/promotion.ts';
import {ablationVariants,freezeSpec,SPORTS_LAYERS,type ExperimentSpec} from '../registry.ts';

const LAYERS=SPORTS_LAYERS.map(l=>l.id);
const UNSUPPORTED=[{id:'injury_rotation',reason:'No reliable, timestamped pre-lock injury or rotation feed is collected, so this layer cannot be tested without inventing data.'}];
const SUPPORTED=new Set(LAYERS.filter(l=>!UNSUPPORTED.some(u=>u.id===l)));

export const SPORTS_ABLATION_SPEC:ExperimentSpec={
 id:'lab-sports-ablation-v1',domain:'sports',registeredAt:'2026-11-12T20:00:00Z',
 hypothesis:'Each predictive layer (recalibration, role/minutes, matchup/rest/opponent, sportsbook market) improves the probability quality '+
  '(Brier, log loss) of NBA player-prop forecasts when added to the base model, and its removal from the combined model makes forecasts worse.',
 modelFamily:'ridge-logistic-v1',layers:LAYERS,unsupportedLayers:UNSUPPORTED,
 variants:ablationVariants(LAYERS,SUPPORTED,'recalibration',10),
 forwardStartsAt:'2026-11-13T00:00:00Z',
 trainingData:{description:'2025-26 NBA regular season (layer-1 priors from 2024-25), SportsDataverse ESPN player box scores, proxy lines',
  through:'2026-04-30T00:00:00Z',sources:[{file:'player_box_2025.csv',sha256:'8e34c5b1b7629dda89483356b5ec40f76a0b534aa273a5ddd8d9ef23f3e0e4f7'},
   {file:'player_box_2026.csv',sha256:'7a4868da67ae7f6ebfba23389e04220be2e3f69d2e56a3942c02aa56f1becc89'}]},
 metrics:{primary:'brier',secondary:['logLoss','ece','decisionHitRate']},
 gate:{minGradedLines:REVIEW_GATE.minGradedLines,minDates:REVIEW_GATE.minDates,minGames:REVIEW_GATE.minGames,
  minCandidateDecisions:REVIEW_GATE.minCandidateDecisions,maxBrierDifferenceUpper95:REVIEW_GATE.maxBrierDifferenceUpper95,
  requireNoWorseLogLoss:true,multipleTesting:'holm',familyAlpha:0.05,bootstrapReplicates:1000,bootstrapSeed:20261112},
 limits:{maxVariants:10,productionShadowLimit:3,paidRequestsPerVariant:0},
 researchOnly:true,
};
export const SPORTS_ABLATION=freezeSpec(SPORTS_ABLATION_SPEC);
