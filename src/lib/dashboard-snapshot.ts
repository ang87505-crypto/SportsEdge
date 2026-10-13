export type ResearchSnapshot={predictions:unknown[];paper:{pending_bets:number;settled_bets:number;win_rate:number|null}};
/** Guard all numbers displayed on the home dashboard; absent/unreliable data is unavailable, never zero. */
export function isResearchSnapshot(v:unknown):v is ResearchSnapshot{
 if(!v||typeof v!=='object')return false;
 const x=v as Record<string,unknown>;
 if(!Array.isArray(x.predictions)||!x.paper||typeof x.paper!=='object')return false;
 const p=x.paper as Record<string,unknown>;
 return Number.isSafeInteger(p.pending_bets)&&Number(p.pending_bets)>=0
  &&Number.isSafeInteger(p.settled_bets)&&Number(p.settled_bets)>=0
  &&(p.win_rate===null||(typeof p.win_rate==='number'&&Number.isFinite(p.win_rate)&&p.win_rate>=0&&p.win_rate<=1));
}
