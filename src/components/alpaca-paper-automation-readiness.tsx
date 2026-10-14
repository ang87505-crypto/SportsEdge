'use client';
import {PAPER_AUTOMATION_RELEASE} from '@/lib/stocks/paper-automation-release';

type State={
 status:string;
 tradingBlocked:boolean;
 accountBlocked:boolean;
 warnings:string[];
 capturedAt:string;
 positionsCount:number;
 orderCount:number;
};
export function AlpacaPaperAutomationReadiness({account}:{account:State}){
 const brokerOk=account.status==='ACTIVE'&&!account.tradingBlocked&&!account.accountBlocked;
 const timestampPresent=Number.isFinite(Date.parse(account.capturedAt));
 const openWarnings=account.warnings.some(x=>
  ['OPEN_ORDER_REQUIRES_RECONCILIATION','ORDER_HISTORY_LIMIT_REACHED','UNKNOWN_ORDER_STATUS','SHORT_POSITION_PRESENT'].includes(x));
 const checks=[
  {label:'Alpaca paper account responds',state:brokerOk?'Observed':'Needs review',
   explanation:'Read-only account status; never constitutes order authorization.'},
  {label:'Broker snapshot timestamp available',state:timestampPresent?'Observed':'Needs review',
   explanation:'Timestamp recorded; actual freshness must be verified again before every proposed order. This page refreshes manually.'},
  {label:'Complete broker order reconciliation',state:'Not implemented',
   explanation:openWarnings?'Existing warnings require attention; only 25 recent orders are displayed.':'A 25-order view cannot establish full order-history completeness.'},
  {label:'Dated, independently reviewed stock signals',state:'Not verified',
   explanation:'A real strategy signal, price feed, availability evidence and source review are missing.'},
  {label:'Staging duplicate protection and receipt storage',state:'Staging only',
   explanation:'A real, private and access-denied staging receipt schema exists. The website does not yet operate a connected receipt service.'},
  {label:'Staging emergency stop',state:'Halted',
   explanation:'The separate staging database contains an auditable HALTED gate. It cannot be re-enabled through the application; this is not yet a production operational kill switch.'},
  {label:'Scheduled paper-order execution',state:'Offline rehearsal only',
   explanation:'Source-checked market hours and limit-order request drafts can be simulated. No deployed scheduler or paper-order submission service exists.'}
 ];
 return <section className="glass panel" aria-labelledby="alpaca-automation-heading" style={{margin:'24px 0'}}>
   <div className="module-top" style={{marginBottom:14}}>
    <span className="pill">PAPER AUTOMATION / ENGINEERING</span>
    <span className="pill pill-amber">Execution disabled</span>
   </div>
   <h2 id="alpaca-automation-heading">Automation readiness</h2>
   <p>We can inspect your paper account now. Automated trading is a separate, higher-risk capability that must be tested and explicitly released. No order is placed from this page.</p>
   <div className="progress-card-grid" style={{margin:'19px 0'}}>
    {checks.map(item=><div className="glass panel" key={item.label}>
      <div className="module-top" style={{marginBottom:10}}>
       <strong style={{fontSize:12}}>{item.label}</strong>
       <span className={item.state==='Observed'?'pill':'pill pill-amber'}>{item.state}</span>
      </div>
      <p style={{fontSize:11,margin:0}}>{item.explanation}</p>
    </div>)}
   </div>
   <div className="notice" role="status">
    <strong>Safety lock:</strong> Automatic paper orders, recurring scheduling and real-money execution are OFF in the application.
    The current engineering contract cannot authorize orders, even with a valid owner session.
   </div>
   <p style={{fontSize:11,marginBottom:0}}>
    Conservative draft controls: buy-only, limit/day orders, $100 maximum per order, $200 daily notional,
    $250 per symbol, five orders per day, and 20% portfolio exposure.
    These limits are engineering test constraints, not an approved release policy.
    Order authorization still requires reviewed broker and source evidence.
   </p>
   {!PAPER_AUTOMATION_RELEASE.placeOrdersEnabled&&<p className="quiet" style={{fontSize:11}}>No manual or automatic paper-order button exists in this version.</p>}
 </section>;
}
