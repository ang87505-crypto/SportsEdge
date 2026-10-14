/** Pure, source-linked realized performance charting.
 * These curves use settled or manually closed events ONLY.
 * They do not imply marked-to-market equity, a broker fill, or an investable return.
 */
export type RealizedEvent={id:string;at:string;profitCents:number};
export type RealizedPoint={sequence:number;at:string;eventId:string;equityCents:number;profitCents:number};

export function realizedSeries(initialCents:number,events:RealizedEvent[]):RealizedPoint[]{
 if(!Number.isSafeInteger(initialCents)||initialCents<0)throw Error('Invalid starting balance');
 if(events.length>1000)throw Error('Realized series exceeds verified bounds');
 if(events.length===0)return [];
 const ids=new Set<string>();
 for(const event of events){
  if(typeof event.id!=='string'||event.id.length<1||event.id.length>128||ids.has(event.id)||
     typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at))||
     !Number.isSafeInteger(event.profitCents))throw Error('Invalid realized event');
  ids.add(event.id);
 }
 const sorted=[...events].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id));
 const points:RealizedPoint[]=[{sequence:0,at:sorted[0].at,eventId:'opening-balance',equityCents:initialCents,profitCents:0}];
 let profit=0;
 for(const event of sorted) {
  profit+=event.profitCents;
  const equity=initialCents+profit;
  if(!Number.isSafeInteger(profit)||!Number.isSafeInteger(equity))throw Error('Realized performance overflow');
  points.push({sequence:points.length,at:event.at,eventId:event.id,equityCents:equity,profitCents:profit});
 }
 return points;
}
