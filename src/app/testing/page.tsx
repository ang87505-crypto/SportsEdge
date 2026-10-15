import Link from 'next/link';
import {PageHeading} from '@/components/ui';
import {TestingWalkthrough} from '@/components/testing-walkthrough';

export const metadata={
 title:'Testing Center | SportsEdge',
 description:'A guided tour of stocks, sports, private paper brokerage, source evidence and automation release gates.'
};
const tracks=[
 {title:'Navigation and usability',status:'Inspectable',text:'Home, Stocks, Sports, paper ledger, Progress and Guide can be reviewed. Mobile and desktop browser smoke runs in CI.'},
 {title:'Private Alpaca PAPER account',status:'Preview review',text:'Owner key and read-only broker viewer belong to protected Preview; available only after owner authentication. Never paste account credentials into a public page.'},
 {title:'Paper-order infrastructure',status:'Staging only',text:'The private outbox is installed only in SportsEdge Staging, not Production. An owner-only staging status/STOP interface exists. The separate acceptance Preview can attempt one explicitly authorized PAPER order only after fresh preflight and release checks; this panel cannot place orders.'},
 {title:'Stock strategy performance',status:'Not established',text:'No genuine after-cost historical returns or profitable algorithm have been demonstrated. Astra\'s research is separate and still under review.'},
 {title:'Scheduled or real-money orders',status:'Off',text:'General recurring stock trading and real-money execution remain disabled. A single explicitly confirmed Alpaca PAPER acceptance order may be released on its isolated Preview; it is not automated stock trading.'}
];
export default function TestingCenter(){
 return <>
  <PageHeading eyebrow="PLATFORM / TESTING" title="Your SportsEdge testing center."
   description="A single starting point for the owner acceptance tour. Review what exists, what is private, and what is still blocked without chasing separate developer Preview links."
   action={<Link className="button button-secondary" href="/progress">Evidence and blockers →</Link>}/>
  <section className="glass panel test-release-banner">
   <div><span className="eyebrow">FULL END-TO-END ACCEPTANCE</span><h2>Not released yet.</h2>
    <p>Navigation and offline simulations are ready to inspect. Live paper-broker reconciliation, owner-authenticated staging, persistent receipt service, and an approved paper-order test still require separate verification.</p></div>
   <span className="pill pill-amber">Execution disabled</span>
  </section>
  <div className="section-title"><h2>What you can test—and what is blocked</h2><span className="pill">Committed capabilities, not live telemetry</span></div>
  <div className="test-status-grid">{tracks.map(x=><article key={x.title} className="glass test-status-card">
    <div className="module-top"><strong>{x.title}</strong><span className={x.status==='Inspectable'?'pill':'pill pill-amber'}>{x.status}</span></div>
    <p>{x.text}</p>
   </article>)}</div>
  <TestingWalkthrough/>
  <section className="glass panel test-help">
   <span className="eyebrow">BEFORE TURNING ON PAPER ORDERS</span>
   <h2>One controlled release—not a hidden switch.</h2>
   <p>Before scheduling or submitting even virtual stock orders, we need reviewed model signals, complete broker reconciliation, a persistent and audited execution outbox, operational risk and emergency-stop controls, authenticated staging checks, and your explicit approval of the specific strategy, budget and limits.</p>
   <div className="button-row"><Link href="/stocks/research" className="button button-secondary">Stock model evidence →</Link><Link href="/guide" className="button button-secondary">Platform guide →</Link></div>
  </section>
 </>;
}
