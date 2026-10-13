/**
 * Alpaca Paper read-only account snapshot. Never provides an order method.
 * Do not expose this module to client components. The API host is immutable.
 */
const PAPER_API = 'https://paper-api.alpaca.markets';
const MAX_REPLY_BYTES = 500_000;
type FetchLike = typeof fetch;

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
  const response=await fetcher(PAPER_API+ALLOWED[kind],{
    method:'GET',headers:alpacaPaperHeaders(config),cache:'no-store',
    redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('Alpaca paper account request failed');
  const raw=await response.text();
  if(raw.length>MAX_REPLY_BYTES)throw new Error('Alpaca paper response unexpectedly large');
  try{return JSON.parse(raw) as unknown;}
  catch{throw new Error('Malformed Alpaca paper response');}
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
  requirePaperSettings(config);
  // All endpoints are READ-ONLY. Failure of any request rejects the entire snapshot.
  const [account,positions,orders]=await Promise.all([
    readPaper('account',config,fetcher),
    readPaper('positions',config,fetcher),
    readPaper('recentOrders',config,fetcher)
  ]);
  return normalizePaperSnapshot(account,positions,orders,now());
}
