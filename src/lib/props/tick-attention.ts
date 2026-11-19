/**
 * Whether a finished capture tick needs the owner's attention (the worker then exits 1, so the GitHub job is red and
 * the operations monitor alerts). A tick is never green when a capture it attempted failed at the provider: before
 * this, a tick whose only capture failed finished as NO_LINES_CAPTURED and exited 0, indistinguishable at the job
 * level from "the provider posted no lines". Changes no capture, prediction, pick, stake or budget decision.
 */
export type TickAttention={attention:boolean;reason:string;notice:string|null};

const RUN_FAILURES=['ODDS_NOT_CONFIGURED','EVENTS_LIST_CHARGED','PROVIDER_EVENTS_FAILED'];

export function tickAttention(outcome:string,summary:Record<string,unknown>|null|undefined):TickAttention{
 if(outcome.startsWith('FAILED')||RUN_FAILURES.includes(outcome))return {attention:true,reason:outcome,notice:null};
 const caps=Array.isArray(summary?.captures)?summary.captures as {outcome?:unknown;event?:unknown}[]:[];
 const failed=caps.filter(c=>c.outcome==='provider_error'||c.outcome==='provider_http');
 if(failed.length)return {attention:true,reason:'CAPTURE_PROVIDER_FAILED',
  notice:`${failed.length} of ${caps.length} capture(s) failed at the provider and are not retried`};
 const budget=caps.filter(c=>c.outcome==='budget_refused'||(c as {skipped?:unknown}).skipped==='budget_changed').length;
 if(budget)return {attention:false,reason:'CREDIT_LIMITED',notice:`${budget} capture(s) deferred by the credit budget (a limit, not a failure)`};
 if(outcome==='NO_LINES_CAPTURED')return {attention:false,reason:'NO_PROVIDER_LINES',notice:'captures ran but the provider posted no PrizePicks/Pick6 lines'};
 return {attention:false,reason:outcome,notice:null};
}
