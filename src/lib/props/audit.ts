/** Recompute a line's outcome from its stored box-score row (ledger audit). Pure. */
import type {Stat} from './contract.ts';
export type AuditGame={did_not_play:boolean;points:number|null;rebounds:number|null;assists:number|null};
export function recomputeOutcome(line:number,stat:Stat,g:AuditGame):'more'|'less'|'tie'|'void_dnp'|'missing_stat'{
 if(g.did_not_play)return 'void_dnp';
 const v=g[stat];
 if(v===null||v===undefined||!Number.isFinite(Number(v)))return 'missing_stat';
 const a=Number(v);
 return a>line?'more':a<line?'less':'tie';
}
