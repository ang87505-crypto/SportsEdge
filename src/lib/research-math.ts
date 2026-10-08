export function decimalOdds(odds: number): number {
  if (!Number.isSafeInteger(odds) || Math.abs(odds) < 100) throw new Error('Invalid American odds');
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}
export function noVig(prices: number[]): number[] {
  if (prices.length !== 2 && prices.length !== 3) throw new Error('Complete two- or three-outcome market required');
  const raw = prices.map(o => 1 / decimalOdds(o));
  const total = raw.reduce((a,b) => a+b,0);
  return raw.map(p => p/total);
}
export type SettledPosition = { stake_cents: number; profit_cents: number; outcome: string; settled_at: string };
export function performance(initial: number, settled: SettledPosition[], pendingStake: number) {
  if (!Number.isSafeInteger(initial) || initial <= 0 || !Number.isSafeInteger(pendingStake) || pendingStake < 0) throw new Error('Invalid bankroll');
  let equity=initial, peak=initial, maxDrawdown=0, maxDrawdownPct=0, stake=0, wins=0, losses=0;
  const curve: { at: string; equity_cents: number }[]=[];
  for (const row of [...settled].sort((a,b)=>a.settled_at.localeCompare(b.settled_at))) {
    if (!Number.isSafeInteger(row.stake_cents) || row.stake_cents<=0 || !Number.isSafeInteger(row.profit_cents) || !['won','lost','void'].includes(row.outcome) || !Number.isFinite(Date.parse(row.settled_at))) throw new Error('Invalid settlement');
    if ((row.outcome==='lost' && row.profit_cents!==-row.stake_cents) || (row.outcome==='won' && row.profit_cents<0) || (row.outcome==='void' && row.profit_cents!==0)) throw new Error('Inconsistent settlement');
    equity+=row.profit_cents;peak=Math.max(peak,equity);
    maxDrawdown=Math.max(maxDrawdown,peak-equity);maxDrawdownPct=Math.max(maxDrawdownPct,(peak-equity)/peak);
    if(row.outcome!=='void')stake+=row.stake_cents;
    wins+=Number(row.outcome==='won');losses+=Number(row.outcome==='lost');
    curve.push({at:row.settled_at,equity_cents:equity});
  }
  if(equity-pendingStake<0)throw new Error('Exposure exceeds bankroll');
  return { equity_cents:equity, available_cents:equity-pendingStake, pending_stake_cents:pendingStake, profit_cents:equity-initial, roi:stake?(equity-initial)/stake:null, win_rate:wins+losses?wins/(wins+losses):null, settled_bets:settled.length, wins,losses,max_drawdown_cents:maxDrawdown,max_drawdown_fraction:maxDrawdownPct,curve };
}
