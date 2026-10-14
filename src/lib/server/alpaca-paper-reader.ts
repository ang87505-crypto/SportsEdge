/**
 * Alpaca Paper read-only account snapshot. Never provides an order method.
 * Do not expose this module to client components. The API host is immutable.
 */
const PAPER_API = 'https://paper-api.alpaca.markets';
const MAX_REPLY_BYTES = 500_000;
type FetchLike = typeof fetch;

// Fixed, non-sensitive diagnostic codes. Never include an upstream response,
// account identifier, credentials, HTTP headers or raw exception text.
export type PaperFailureReason =
  'PAPER_AUTH_REJECTED'|'PAPER_ACCESS_FORBIDDEN'|'PAPER_RATE_LIMITED'|
  'PAPER_UPSTREAM_ERROR'|'PAPER_TRANSPORT_ERROR'|'PAPER_REPLY_TOO_LARGE'|
  'PAPER_INVALID_JSON'|'PAPER_PAYLOAD_INVALID'|'PAPER_CREDENTIAL_FORMAT_INVALID';
export type PaperFailureStage = 'config'|'account'|'positions'|'recentOrders'|'normalize';
export class PaperConnectionError extends Error {
  readonly reason:PaperFailureReason;
  readonly stage:PaperFailureStage;
  constructor(reason:PaperFailureReason,stage:PaperFailureStage) {
    super('Paper broker diagnostic failed');
    this.name='PaperConnectionError';
    this.reason=reason;
    this.stage=stage;
  }
}

type AlpacaPaperSettings = { keyId:string; secretKey:string };
type PlainObject = Record<string,unknown>;
function isObject(v:unknown):v is PlainObject {
  return v!==null && typeof v==='object' && !Array.isArray(v);
}
function mustString(v:unknown,name:string,max=80):string {
  if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('Invalid Alpaca field: '+name);
  return v;
}
function money(v:unknown,name:string):string {
  const s=mustString(v,name,32);
  if(!/^-?[0-9]{1,15}(?:\.[0-9]{1,6})?$/.test(s))throw new Error('Invalid Alpaca money: '+name);
  return s;
}
function qty(v:unknown,name:string):string {
  const s=mustString(v,name,32);
  if(!/^[0-9]{1,13}(?:\.[0-9]{1,9})?$/.test(s))throw new Error('Invalid Alpaca quantity: '+name);
  return s;
}
function symbol(v:unknown) {
  const s=mustString(v,'symbol',16);
  if(!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(s))throw new Error('Unexpected ticker');
  return s;
}
function timestamp(v:unknown,name:string) {
  const s=mustString(v,name,50);
  if(!Number.isFinite(Date.parse(s)))throw new Error('Invalid Alpaca date: '+name);
  return s;
}
export function requirePaperSettings(input:AlpacaPaperSettings) {
  if(!input || typeof input.keyId!=='string'||input.keyId.trim().length<8||
     typeof input.secretKey!=='string'||input.secretKey.trim().length<16 ||
     input.keyId.length>256||input.secretKey.length>256) {
    throw new Error('Alpaca PAPER credentials are not configured');
  }
}
export function alpacaPaperHeaders(config:AlpacaPaperSettings) {
  requirePaperSettings(config);
  return {
    'APCA-API-KEY-ID':config.keyId,
    'APCA-API-SECRET-KEY':config.secretKey,
    'Accept':'application/json'
  };
}
// Hardcoded endpoint allowlist; no caller-controlled URLs or HTTP methods.
const ALLOWED = {
  account: '/v2/account',
  positions: '/v2/positions',
  recentOrders: '/v2/orders?status=all&limit=25&direction=desc'
} as const;
async function readPaper(
  kind:keyof typeof ALLOWED, config:AlpacaPaperSettings, fetcher:FetchLike
):Promise<unknown> {
  let response:Response;
  try {
    response=await fetcher(PAPER_API+ALLOWED[kind],{
      method:'GET',headers:alpacaPaperHeaders(config),cache:'no-store',
      redirect:'error',signal:AbortSignal.timeout(12000)
    });
  } catch {
    throw new PaperConnectionError('PAPER_TRANSPORT_ERROR',kind);
  }
  if(!response.ok) {
    // Deliberately ignore the provider response body and diagnostic headers.
    const reason=response.status===401?'PAPER_AUTH_REJECTED'
      :response.status===403?'PAPER_ACCESS_FORBIDDEN'
      :response.status===429?'PAPER_RATE_LIMITED':'PAPER_UPSTREAM_ERROR';
    throw new PaperConnectionError(reason,kind);
  }
  let raw:string;
  try { raw=await response.text(); }
  catch { throw new PaperConnectionError('PAPER_TRANSPORT_ERROR',kind); }
  if(raw.length>MAX_REPLY_BYTES)throw new PaperConnectionError('PAPER_REPLY_TOO_LARGE',kind);
  try{return JSON.parse(raw) as unknown;}
  catch{throw new PaperConnectionError('PAPER_INVALID_JSON',kind);}
}
const OPEN_ORDER_STATES=new Set([
  'new','accepted','pending_new','accepted_for_bidding','partially_filled',
  'pending_cancel','pending_replace','done_for_day','stopped','suspended',
  'calculated','held'
]);
const TERMINAL_ORDER_STATES=new Set([
  'filled','canceled','expired','rejected','replaced'
]);
export function normalizePaperSnapshot(
  accountRaw:unknown, positionsRaw:unknown, ordersRaw:unknown, capturedAt:string
) {
  if(!isObject(accountRaw)||!Array.isArray(positionsRaw)||!Array.isArray(ordersRaw)) {
    throw new Error('Unexpected Alpaca paper response shape');
  }
  if(positionsRaw.length>200||ordersRaw.length>25) {
    throw new Error('Alpaca paper response outside configured bounds');
  }
  const account={
    status:mustString(accountRaw.status,'status',32),
    currency:mustString(accountRaw.currency,'currency',8),
    equityUsd:money(accountRaw.equity,'equity'),
    cashUsd:money(accountRaw.cash,'cash'),
    portfolioValueUsd:money(accountRaw.portfolio_value,'portfolio_value'),
    buyingPowerUsd:money(accountRaw.buying_power,'buying_power'),
    accountBlocked:accountRaw.account_blocked,
    tradingBlocked:accountRaw.trading_blocked
  };
  if(account.currency!=='USD' || typeof account.accountBlocked!=='boolean' ||
     typeof account.tradingBlocked!=='boolean')throw new Error('Unexpected Alpaca paper account conventions');

  const seenSymbols=new Set<string>();
  const positions=positionsRaw.map((raw:unknown)=>{
    if(!isObject(raw))throw new Error('Unexpected Alpaca paper position');
    const s=symbol(raw.symbol);
    if(seenSymbols.has(s))throw new Error('Duplicate Alpaca paper ticker');
    seenSymbols.add(s);
    if(raw.side!=='long'&&raw.side!=='short')throw new Error('Unexpected Alpaca position side');
    return {symbol:s,side:raw.side,qty:qty(raw.qty,'qty'),
      marketValueUsd:money(raw.market_value,'market_value')};
  });
  const seenOrders=new Set<string>();
  const recentOrders=ordersRaw.map((raw:unknown)=>{
    if(!isObject(raw))throw new Error('Unexpected Alpaca paper order');
    const id=mustString(raw.id,'order ID',128);
    if(seenOrders.has(id))throw new Error('Duplicate Alpaca order');
    seenOrders.add(id);
    const status=mustString(raw.status,'order status',60);
    return {
      id,status,createdAt:timestamp(raw.created_at,'order created_at'),
      symbol:symbol(raw.symbol),side:mustString(raw.side,'order side',16)
    };
  });
  const warnings:string[]=[];
  if(account.status.toUpperCase()!=='ACTIVE')warnings.push('ACCOUNT_NOT_ACTIVE');
  if(account.accountBlocked||account.tradingBlocked)warnings.push('ACCOUNT_BLOCKED');
  if(positions.some(p=>p.side==='short'))warnings.push('SHORT_POSITION_PRESENT');
  if(recentOrders.some(o=>OPEN_ORDER_STATES.has(o.status)))warnings.push('OPEN_ORDER_REQUIRES_RECONCILIATION');
  if(recentOrders.some(o=>!OPEN_ORDER_STATES.has(o.status)&&!TERMINAL_ORDER_STATES.has(o.status)))
    warnings.push('UNKNOWN_ORDER_STATUS');
  if(recentOrders.length===25)warnings.push('ORDER_HISTORY_LIMIT_REACHED');
  const captured=timestamp(capturedAt,'capturedAt');
  return {
    source:'Alpaca Paper API' as const,
    accountType:'paper' as const, capturedAt:captured,
    account,positions,recentOrders,warnings,
    readOnly:true as const,
    automaticPaperOrdersEnabled:false as const,
    realMoneyOrdersEnabled:false as const,
    stockSelectionDataVerified:false as const,
    completeOrderHistoryVerified:false as const,
    state:'READ_ONLY_DIAGNOSTIC_NOT_EXECUTION_AUTHORIZATION' as const
  };
}
export async function getAlpacaPaperSnapshot(
  config:AlpacaPaperSettings, fetcher:FetchLike=fetch, now:()=>string=()=>new Date().toISOString()
) {
  try { requirePaperSettings(config); }
  catch { throw new PaperConnectionError('PAPER_CREDENTIAL_FORMAT_INVALID','config'); }
  // Diagnostic reads must be sequential: validate paper-account authentication
  // before requesting positions or orders. With parallel requests, the "stage"
  // would be whichever failed first, not proof the account request succeeded.
  // All endpoints are strictly READ-ONLY. Any failure rejects the snapshot.
  const account=await readPaper('account',config,fetcher);
  const positions=await readPaper('positions',config,fetcher);
  const orders=await readPaper('recentOrders',config,fetcher);
  try { return normalizePaperSnapshot(account,positions,orders,now()); }
  catch { throw new PaperConnectionError('PAPER_PAYLOAD_INVALID','normalize'); }
}
