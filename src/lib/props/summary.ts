/**
 * Plain-language headline numbers for one props platform, shared by the Overview and the
 * props page. Pure. Unknown stays unknown (null), never zero.
 */
import type {PropsView} from './dashboard-view.ts';

export type PropsSummary={
 balanceCents:number|null;
 netCents:number|null;
 /** Realized profit / stakes of settled entries with a known payout. Null until one settles. */
 roi:number|null;
 record:{won:number;lost:number;refund:number;unknown:number};
 openEntries:number;
 hitRate:number|null;graded:number;correct:number;
 /** Recorded picks whose game has not locked yet, most confident first. */
 upcoming:{id:number;player:string;side:'more'|'less';line:number;stat:string;probability:number;game:string;lockAt:string;
  mean:number|null;market:PropsView['lines'][number]['market'];oppAllowedRatio:number|null}[];
};

export function propsSummary(v:PropsView):PropsSummary{
 const known=v.entries.filter(e=>e.settlement&&e.settlement.profitCents!==null);
 const staked=known.reduce((a,e)=>a+e.stakeCents,0);
 const net=v.bankroll?v.bankroll.realizedProfitCents:null;
 const upcoming=v.lines.filter(l=>l.decision==='recorded'&&!l.locked&&l.side&&l.pMore!==null&&l.pLess!==null)
  .map(l=>({id:l.id,player:l.player,side:l.side!,line:l.line,stat:l.stat,game:l.game,lockAt:l.lockAt,mean:l.mean,market:l.market,oppAllowedRatio:l.oppAllowedRatio,
   probability:l.side==='more'?l.pMore!:l.pLess!}))
  .sort((a,b)=>b.probability-a.probability||a.lockAt.localeCompare(b.lockAt));
 const settled=v.entries.filter(e=>e.settlement);
 return {
  balanceCents:v.bankroll?v.bankroll.balanceCents:null,
  netCents:net,
  roi:net!==null&&staked>0?net/staked:null,
  record:{won:settled.filter(e=>e.settlement!.outcome==='won').length,lost:settled.filter(e=>e.settlement!.outcome==='lost').length,
   refund:settled.filter(e=>e.settlement!.outcome==='refund').length,unknown:settled.filter(e=>e.settlement!.profitCents===null).length},
  openEntries:v.entryStats.open,
  hitRate:v.accuracy.hitRate,graded:v.accuracy.graded,correct:v.accuracy.correct,
  upcoming,
 };
}

/** Short New Mexico (Mountain) time, e.g. "Sun, Nov 8, 12:10 PM MST". */
export function mtShort(iso:string|null|undefined):string{
 if(!iso||!Number.isFinite(Date.parse(iso)))return '—';
 return new Intl.DateTimeFormat('en-US',{timeZone:'America/Denver',weekday:'short',month:'short',day:'numeric',
  hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(iso));
}

/** "Stats: 22.4 expected · Books: 58% More (2 books) · tough matchup" — parts that are unknown are left out. */
export function whyLine(x:{mean:number|null;market:{booksAtSameLine:number;pMoreBooks:number|null}|null;oppAllowedRatio:number|null}):string{
 const parts:string[]=[];
 if(x.mean!==null)parts.push(`Stats: ${x.mean.toFixed(1)} expected`);
 if(x.market?.pMoreBooks!=null)parts.push(`Books: ${Math.round(x.market.pMoreBooks*100)}% More (${x.market.booksAtSameLine} book${x.market.booksAtSameLine===1?'':'s'})`);
 if(x.oppAllowedRatio!==null)parts.push(x.oppAllowedRatio>=1.05?'soft matchup':x.oppAllowedRatio<=0.95?'tough matchup':'neutral matchup');
 return parts.join(' · ');
}

/** One line for the Overview and Automation pages, e.g. "Learning model v3 · learning on · auto-switch off". */
export function learningStatus(m:{active:string;learningEnabled:boolean;autoSwitchEnabled:boolean}|null):string{
 if(!m)return 'Stats model · learning not set up yet';
 const name=m.active==='props-nb-minutes-rate-v1'?'Stats model':m.active.replace(/^props-learn-v/,'Learning model v');
 return `${name} · learning ${m.learningEnabled?'on':'off'} · auto-switch ${m.autoSwitchEnabled?'on':'off'}`;
}
