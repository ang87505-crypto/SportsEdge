import 'server-only';
/** Owner-triggered ONE NBA simulated bet only. No sportsbook, paid data refresh,
 * cron, or 100x$10 study writes. */
import {forecasts,researchDb} from './research-db';
import {selectOneNbaPaperCandidate,type NbaCandidate,type NbaQuote} from '../nba-paper-run-contract';
type Account={id:number;initial_cents:number};
type Prior={id:number;forecast_id:number};
const SLUG='nba-elo-research-v1';
export type NbaPaperPreview={mode:'VIRTUAL_ONLY';scope:'shared_nba_1pct_ledger';
 checkedAt:string;accountInitialCents:number;recordedCount:number;
 freshMarketGroups:number;candidate:NbaCandidate|null;
 automaticRunEnabled:false;realMoneyEnabled:false};
async function readAccount(){
 const a=await researchDb<Account[]>('research_accounts?select=id,initial_cents&slug=eq.'+SLUG+'&limit=2');
 if(a.length!==1||!Number.isSafeInteger(a[0].id)||a[0].id<1||
  !Number.isSafeInteger(Number(a[0].initial_cents)))
  throw Error('NBA_ACCOUNT_UNVERIFIED');
 const positions=await researchDb<Prior[]>('research_positions?select=id,forecast_id&account_id=eq.'+
  a[0].id+'&order=id.desc&limit=1000');
 if(positions.length>=1000||positions.some(p=>!Number.isSafeInteger(p.id)||!Number.isSafeInteger(p.forecast_id)))
  throw Error('NBA_LEDGER_INCOMPLETE');
 return {account:a[0],positions};
}
export async function previewOneNbaPaperBet(
 now:()=>string=()=>new Date().toISOString()
):Promise<NbaPaperPreview>{
 const checkedAt=now(),time=Date.parse(checkedAt);
 if(!Number.isFinite(time))throw Error('CLOCK_UNVERIFIED');
 const {account,positions}=await readAccount();
 const all=await forecasts();
 if(all.length>=100)throw Error('NBA_FORECAST_LIMIT');
 const eligible=all.filter(f=>Date.parse(f.starts_at)>time&&
  f.model_version==='nba-elo-k20-h65-2026-04-v1'&&
  !positions.some(p=>p.forecast_id===f.id));
 const ids=[...new Set(eligible.map(f=>f.game_id))];
 if(ids.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('GAME_IDS_UNVERIFIED');
 let quotes:NbaQuote[]=[];
 if(ids.length){
  quotes=await researchDb<NbaQuote[]>(
   'odds_snapshots?select=id,game_id,sportsbook,provider,selection,american_odds,observed_at,ingested_at'+
   '&market=eq.h2h&line=is.null&game_id=in.('+ids.join(',')+')'+
   '&observed_at=gte.'+encodeURIComponent(new Date(time-3600_000).toISOString())+
   '&order=observed_at.desc,id.desc&limit=1000');
  if(quotes.length>=1000)throw Error('NBA_QUOTES_INCOMPLETE');
 }
 const plan=selectOneNbaPaperCandidate({forecasts:all,quotes,
  recordedForecastIds:positions.map(p=>p.forecast_id),now:checkedAt});
 return {mode:'VIRTUAL_ONLY',scope:'shared_nba_1pct_ledger',
  checkedAt,accountInitialCents:Number(account.initial_cents),
  recordedCount:positions.length,freshMarketGroups:plan.eligibleMarkets,
  candidate:plan.candidate,automaticRunEnabled:false,realMoneyEnabled:false};
}
export class NbaPaperRunError extends Error{
 constructor(readonly code:'NO_ELIGIBLE_BET'|'PREVIEW_EXPIRED_OR_CHANGED'|
  'RECEIPT_UNVERIFIED'|'INVALID_REQUEST'){
  super('NBA simulated placement cannot be confirmed');
  this.name='NbaPaperRunError';
 }
}
export function verifyNbaPaperRequest(x:unknown):
 asserts x is {confirm:'RECORD_ONE_VIRTUAL_NBA_BET';gameId:number;forecastId:number;quoteId:number}{
 if(!x||typeof x!=='object'||Array.isArray(x))throw new NbaPaperRunError('INVALID_REQUEST');
 const d=x as Record<string,unknown>;
 if(Object.keys(d).length!==4||d.confirm!=='RECORD_ONE_VIRTUAL_NBA_BET'||
  !['gameId','forecastId','quoteId'].every(k=>Number.isSafeInteger(d[k])&&(d[k] as number)>0))
  throw new NbaPaperRunError('INVALID_REQUEST');
}
export async function recordOneNbaPaperBet(input:unknown){
 verifyNbaPaperRequest(input);
 // Ignore any browser odds/stake/probability; recompute on authoritative DB reads.
 const review=await previewOneNbaPaperBet();
 const c=review.candidate;
 if(!c)throw new NbaPaperRunError('NO_ELIGIBLE_BET');
 if(input.forecastId!==c.forecastId||input.quoteId!==c.quoteId||
  input.gameId!==c.gameId)throw new NbaPaperRunError('PREVIEW_EXPIRED_OR_CHANGED');
 const {account}=await readAccount();
 // Transactional existing RPC: account lock, duplicate uniqueness, 1% virtual
 // stake, 1h quote limit, no-vig/EV eligibility and complete market again.
 const id=await researchDb<number>('rpc/research_place',{
  p_account:account.id,p_forecast:c.forecastId,p_quote:c.quoteId});
 if(!Number.isSafeInteger(id)||id<1)throw new NbaPaperRunError('RECEIPT_UNVERIFIED');
 const rows=await researchDb<Array<{id:number;forecast_id:number;
  odds_snapshot_id:number;stake_cents:number;selection:string;american_odds:number}>>(
  'research_positions?select=id,forecast_id,odds_snapshot_id,stake_cents,selection,american_odds'+
  '&account_id=eq.'+account.id+'&id=eq.'+id+'&limit=2');
 if(rows.length!==1||rows[0].forecast_id!==c.forecastId||
  rows[0].odds_snapshot_id!==c.quoteId||rows[0].selection!==c.selection||
  rows[0].american_odds!==c.americanOdds||
  !Number.isSafeInteger(Number(rows[0].stake_cents))||
  Number(rows[0].stake_cents)<100||Number(rows[0].stake_cents)>1000)
  throw new NbaPaperRunError('RECEIPT_UNVERIFIED');
 return {status:'RECORDED_VIRTUAL_POSITION' as const,
  positionId:id,gameId:c.gameId,forecastId:c.forecastId,
  quoteId:c.quoteId,selection:c.selection,
  stakeCents:Number(rows[0].stake_cents),sportsbook:c.sportsbook,
  automaticRunEnabled:false as const,realMoneyEnabled:false as const};
}
