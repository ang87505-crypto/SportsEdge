/** Browser-only display validation for owner-authenticated PAPER diagnostics.
 * Diagnostic codes are fixed and sanitized; never expose upstream errors/secrets.
 * These helpers grant no permission to trade. The server independently enforces safety.
 */
export type SavedPaperStatus={
 status:string;gateHalted:boolean;symbol?:string;limitCents?:number;
 shares?:number;brokerOrderObserved?:boolean;brokerStatus?:string
};
export type OneOrderCheck={oneShotReleaseReady:boolean;stage:SavedPaperStatus};
export type PaperPreflightCheck={
 status:'READ_ONLY_PREFLIGHT';symbol:string;shares:1;limitCents:number;
 checkedAt:string;marketOpen:boolean;sessionCloseAt:string|null;
 staging:'HALTED'|'UNAVAILABLE';blockers:string[];
 quote:null|{bidCents:number;askCents:number;observedAt:string};
 brokerOrderSubmitted:false;ownerApproved:false;executionPermitted:false
};
type JsonObject=Record<string,unknown>;
const obj=(value:unknown):value is JsonObject=>
 value!==null&&typeof value==='object'&&!Array.isArray(value);
const stamp=(s:unknown)=>typeof s==='string'&&s.length<=60&&
 Number.isFinite(Date.parse(s));
const cent=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=1&&(n as number)<=2500;
const code=(v:unknown)=>typeof v==='string'&&/^[A-Z0-9_]{1,80}$/.test(v);

export function parseOneOrderCheck(value:unknown):OneOrderCheck|null{
 if(!obj(value)||typeof value.oneShotReleaseReady!=='boolean'||!obj(value.stage))
  return null;
 const stage=value.stage;
 if(typeof stage.status!=='string'||!/^[a-z_]{1,65}$/.test(stage.status)||
    typeof stage.gateHalted!=='boolean')return null;
 if(stage.symbol!==undefined&&
   (typeof stage.symbol!=='string'||!/^[A-Z]{1,5}$/.test(stage.symbol)))return null;
 if(stage.limitCents!==undefined&&!cent(stage.limitCents))return null;
 if(stage.shares!==undefined&&stage.shares!==1)return null;
 if(stage.brokerOrderObserved!==undefined&&
   typeof stage.brokerOrderObserved!=='boolean')return null;
 if(stage.brokerStatus!==undefined&&stage.brokerStatus!==null&&
   (typeof stage.brokerStatus!=='string'||stage.brokerStatus.length>80))return null;
 return {oneShotReleaseReady:value.oneShotReleaseReady,
  stage:stage as SavedPaperStatus};
}
export function parsePaperPreflight(value:unknown,symbol:string,limitCents:number):
 PaperPreflightCheck|null{
 if(!obj(value)||value.status!=='READ_ONLY_PREFLIGHT'||value.symbol!==symbol||
    !/^[A-Z]{1,5}$/.test(symbol)||!cent(limitCents)||
    value.shares!==1||value.limitCents!==limitCents||
    !stamp(value.checkedAt)||typeof value.marketOpen!=='boolean'||
    (value.sessionCloseAt!==null&&!stamp(value.sessionCloseAt))||
    !['HALTED','UNAVAILABLE'].includes(String(value.staging))||
    value.brokerOrderSubmitted!==false||value.ownerApproved!==false||
    value.executionPermitted!==false||!Array.isArray(value.blockers)||
    value.blockers.length>30||!value.blockers.every(code))return null;
 if(value.quote!==null){
  if(!obj(value.quote)||!cent(value.quote.bidCents)||!cent(value.quote.askCents)||
     (value.quote.bidCents as number)>(value.quote.askCents as number)||
     !stamp(value.quote.observedAt))return null;
 }
 return value as PaperPreflightCheck;
}
const explanations:Record<string,string>={
 UNVERIFIED_EQUITY_ELIGIBILITY:'The broker did not confirm this symbol is an eligible US equity.',
 MARKET_CLOSED_OR_CLOCK_UNVERIFIED:'Regular US stock-market hours or the broker clock are not verified.',
 QUOTE_MISSING_OR_STALE:'No sufficiently recent IEX quote was verified. Try again during the session.',
 STAGING_CREDENTIAL_OR_STATUS_UNAVAILABLE:'The Preview could not verify the staging safety gate.',
 STAGING_EMERGENCY_STOP_ENGAGED:'The staging emergency stop is engaged by design until an approved claim.',
 NO_OWNER_APPROVED_EXECUTION_PATH:'No owner-approved execution has been recorded.',
 NO_DURABLE_BROKER_ORDER_RELEASE:'The preflight alone does not release an order.',
 PAPER_ACCOUNT_NOT_TRADEABLE:'The paper account is inactive or broker-restricted.',
 PAPER_POSITIONS_NEED_REVIEW:'Existing paper positions require review before a test.',
 ACCOUNT_SNAPSHOT_WARNINGS:'The broker account snapshot contains unresolved warnings.',
 PAPER_ACCOUNT_VALUES_UNVERIFIED:'Cash, buying power or equity could not be verified.',
 PAPER_CASH_OR_EXPOSURE_LIMIT:'This order would exceed the configured virtual cash or exposure cap.',
 BROKER_OPEN_ORDERS_REQUIRE_REVIEW:'Existing open broker orders require reconciliation.',
 BROKER_ORDER_HISTORY_NOT_FRESH:'The full broker order history is not fresh enough.',
 WIDE_QUOTE_SPREAD:'The bid/ask spread exceeds the permitted threshold.',
 LIMIT_OUTSIDE_REVIEW_RANGE:'The limit is outside the permitted range of the latest ask.',
 STAGING_EXISTING_INTENTS_REVIEW:'Existing staging intents or uncertain receipts need review.'
};
export function explainPaperBlocker(value:string){
 return explanations[value]??'An unrecognized safeguard is blocking the test. Ask for engineering review.';
}
export function explainPaperRequestFailure(
 status:number,payload:unknown,kind:'release'|'preflight'
):string{
 if(status===401)return 'Owner session expired or this is a different Preview domain. Unlock the dashboard again.';
 if(status===403)return 'This Preview rejected the request. Open and unlock the exact acceptance Preview domain.';
 if(status===400)return 'The request was rejected. Recheck the ticker, limit and selected deployment.';
 const body=obj(payload)?payload:{};
 if(kind==='release'&&body.status==='staging_unavailable')
  return 'The Preview could not verify the staging database. Submission remains disabled.';
 if(kind==='preflight'){
  if(body.status==='paper_connection_unavailable')
   return 'Alpaca PAPER credentials are unavailable on this Preview.';
  if(body.reason==='BROKER_UNAVAILABLE')
   return 'Alpaca PAPER or market data could not be reached or authenticated.';
  if(body.reason==='INVALID_BROKER_DATA')
   return 'Alpaca returned incomplete or inconsistent data. No order is authorized.';
 }
 return kind==='release'
  ? 'Could not verify the current release and staging status. Submission disabled.'
  : 'Read-only broker preflight could not be verified. No order was sent.';
}
