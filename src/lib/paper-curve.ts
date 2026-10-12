/** Geometry only. No market prices, virtual fills, or portfolio accounting are inferred here. */
export type SettledEquityPoint = { at: string; equity_cents: number };
export type EquityPlot = {
  line: string;
  area: string;
  baselineY: number;
  lowCents: number;
  highCents: number;
  coordinates: { x: number; y: number }[];
};
export function buildEquityPlot(
  initialCents: number,
  settlements: readonly SettledEquityPoint[],
  width = 720,
  height = 190
): EquityPlot {
  if (!Number.isSafeInteger(initialCents) || initialCents <= 0) throw new Error('Invalid initial paper bankroll');
  if (!Array.isArray(settlements) || settlements.length > 1000) throw new Error('Invalid equity history size');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Invalid chart size');
  let previous = -Infinity;
  const values = [initialCents];
  for (const point of settlements) {
    const time = Date.parse(point.at);
    if (!Number.isFinite(time) || time < previous || !Number.isSafeInteger(point.equity_cents) || point.equity_cents < 0) {
      throw new Error('Invalid settled equity point');
    }
    previous = time;
    values.push(point.equity_cents);
  }
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const pad = Math.max(1, Math.round((highest - lowest) * 0.15));
  const lowCents = Math.max(0, lowest - pad);
  const highCents = highest + pad;
  const scale = highCents - lowCents;
  const coordinates = values.map((v, i) => ({
    x: Number((i * width / Math.max(1, values.length - 1)).toFixed(2)),
    y: Number((height * (highCents - v) / scale).toFixed(2)),
  }));
  const line = coordinates.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  return {
    line,
    area: `${line} L${width} ${height} L0 ${height} Z`,
    baselineY: Number((height * (highCents - initialCents) / scale).toFixed(2)),
    lowCents,
    highCents,
    coordinates,
  };
}
