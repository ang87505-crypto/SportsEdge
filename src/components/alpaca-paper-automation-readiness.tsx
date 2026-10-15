'use client';
import {PAPER_AUTOMATION_RELEASE} from '@/lib/stocks/paper-automation-release';
type State={status:string;tradingBlocked:boolean;accountBlocked:boolean;
 warnings:string[];capturedAt:string;positionsCount:number;orderCount:number};
export function AlpacaPaperAutomationReadiness({account}:{account:State}){
 const brokerOk=account.status==='ACTIVE'&&!account.tradingBlocked&&!account.accountBlocked;
 const dated=Number.isFinite(Date.parse(account.capturedAt));
 const checks=[
  {label:'Alpaca PAPER account',state:brokerOk?'Observed':'Needs review',
   explanation:'The owner-authenticated, read-only account snapshot was obtained. This does not release execution.'},
  {label:'Broker snapshot age',state:dated?'Captured':'Unknown',
   explanation:dated?'Captured at '+new Date(account.capturedAt).toLocaleString()+'. Manually refresh before relying on it.':'Missing valid capture time. Treat this snapshot as unavailable.'},
  {label:'Full broker order history',state:'Check on demand',
   explanation:'The separate read-only reconciliation control enumerates broker orders. The latest '+account.orderCount+' dashboard orders do not prove completeness.'},
  {label:'First owner-authorized PAPER order',state:'Check release below',
   explanation:'The dedicated one-share test has an independently verified release/STOP status on its own panel. Only the acceptance Preview may permit a separately confirmed order.'},
  {label:'Staging emergency stop',state:'Verify below',
   explanation:'Read or record the staging STOP in its owner-only panel. The account snapshot does not establish the current STOP state.'},
  {label:'Dated stock strategy signals',state:'Not linked to broker',
   explanation:'Research and rebalancing proposals are not authenticated live signals or verified automated orders.'},
  {label:'Unattended scheduled paper trading',state:'Off',
   explanation:'There is no released stock scheduler or durable multi-order lifecycle controller.'}
 ];
 return <section className="glass panel" aria-labelledby="alpaca-automation-heading" style={{margin:'24px 0'}}>
  <div className="module-top" style={{marginBottom:14}}>
   <span className="pill">PAPER AUTOMATION / VERIFIABLE EVIDENCE</span>
   <span className="pill pill-amber">Scheduled execution OFF</span>
  </div>
  <h2 id="alpaca-automation-heading">What is ready, and what still needs proof?</h2>
  <p>These indicators distinguish broker observations from pending integration. They are not a live monitoring feed, and none authorizes a trade.</p>
  <div className="progress-card-grid" style={{margin:'19px 0'}}>
   {checks.map(item=><div className="glass panel" key={item.label}>
    <div className="module-top" style={{marginBottom:10}}>
     <strong style={{fontSize:12}}>{item.label}</strong><span className={item.state==='Observed'?'pill':'pill pill-amber'}>{item.state}</span>
    </div><p style={{fontSize:11,margin:0}}>{item.explanation}</p>
   </div>)}
  </div>
  {account.warnings.length>0&&<p className="notice">Broker warnings: {account.warnings.join(' · ')}. Review before any order.</p>}
  <p className="notice"><strong>Independent gates:</strong> The one-order owner test, staging emergency STOP and complete broker history each have their own checks below. An old read-only status never enables a new submission.</p>
  <p style={{fontSize:11}}>Release manifest: general orders {PAPER_AUTOMATION_RELEASE.placeOrdersEnabled?'enabled':'OFF'}, recurring orders {PAPER_AUTOMATION_RELEASE.scheduledOrdersEnabled?'enabled':'OFF'}, real-money {PAPER_AUTOMATION_RELEASE.realMoneyEnabled?'enabled':'OFF'}. The acceptance branch may separately enable only one owner-confirmed PAPER order.</p>
 </section>;
}