import {Evidence,type EvidenceKind} from '@/components/ui';
import protocol from '../../research/stock_audit_20261012/protocol.json';
import study from '@/data/research/stock_1000_forward_study.json';

/*
 * The four stock evidence tracks, kept visibly separate so a synthetic or
 * unverified figure can never be read as a historical or forward return.
 */
export const STOCK_TRACKS:{title:string;kind:EvidenceKind;state:string;text:string}[]=[
 {title:'Verified historical backtest',kind:protocol.release.historical_performance_measured?'verified':'not-measured',state:protocol.release.historical_performance_measured?'Report available':'Not measured',
  text:'Requires licensed point-in-time membership, delistings and corporate-event reconciliation before any return is reported.'},
 {title:'Synthetic engineering tests',kind:'synthetic',state:'Engineering only',
  text:'Fixtures prove accounting and safety code paths. Their balances are not performance and are never shown as profit.'},
 {title:'Forward paper trading',kind:study.events.length?'broker':'not-measured',state:study.events.length?`${study.events.length} events`:'Not started',
  text:`Pre-registered $${(study.starting_cash_cents/100).toLocaleString()} forward study. Results appear only from reconciled Alpaca PAPER fills.`},
 {title:'Unverified research',kind:'unverified',state:'1 candidate',
  text:`Hold-rank buffer candidate (rank ≤ ${protocol.candidate_rules.hold_rank_max}). No parameter search; no claim of better returns.`},
];

export function StockEvidenceTracks(){
 return <div className="track-grid">{STOCK_TRACKS.map(t=><div key={t.title} className="track">
  <div className="track-top"><Evidence kind={t.kind}/><span className="track-state">{t.state}</span></div>
  <strong>{t.title}</strong><p>{t.text}</p>
 </div>)}</div>;
}
