import {Suspense} from 'react';
import Link from 'next/link';
import {Panel,Skeleton} from '@/components/ui';
import {AssistantChat} from '@/components/assistant-chat';
import {CommandStrip} from '@/components/command-strip';
import {BriefingNow,BriefingBoard} from '@/components/briefing-home';

const HOME_STARTERS=['How much did we make yesterday?',"How did all our predictions do yesterday, including ones we didn't bet?",'How did our 60%+ tracked lines do yesterday?','What did our AI learn?','Why did we choose this lineup?',"Why didn't we trade?",
 'Which features actually improve our predictions?','How accurate are our 80% predictions actually?','Would flat staking have performed better?','What has Kalshi weather research recorded?','Are there real Kalshi opportunities yet?','Is everything running?'];

function StripFallback(){
 return <ul className="command-strip" aria-label="Summary">{['Automation','Virtual P&L','Active models','Next','Needs you'].map(l=>
  <li key={l}><div className="command-strip-item"><span className="command-strip-label">{l}</span><Skeleton lines={2}/></div></li>)}</ul>;
}
function BoardFallback(){
 return <div className="home-grid briefing-grid">
  {['Today','Results','Next'].map(t=><Panel key={t} title={t}><Skeleton lines={4}/></Panel>)}
 </div>;
}

/** Chat-first command center: the summary strip, the conversation, the live status rail, then the full briefing. */
export default function Home(){
 return <div className="command">
  <section className="command-head" aria-labelledby="home-title">
   <div className="command-head-copy">
    <div className="command-eyebrow"><span className="command-eyebrow-pulse" aria-hidden="true"/>SPORTSEDGE <span className="command-eyebrow-divider">/</span> INTELLIGENCE WORKSPACE</div>
    <h1 id="home-title">Command <span>Center</span></h1>
    <p>Your unified view of sports intelligence, market research, model performance, and automated operations. Ask a question or inspect the live record.</p>
    <div className="command-head-tags"><span>SPORTS INTELLIGENCE</span><span>MARKET RESEARCH</span><span>PAPER ONLY</span></div>
   </div>
   <aside className="command-head-aside" aria-label="Operating mode">
    <div className="command-orbit" aria-hidden="true"><span/><span/><span/><i/></div>
    <div className="command-mode-copy"><span className="command-mode-label">OPERATING ENVIRONMENT</span><strong>Research <b>/</b> PAPER</strong><small>Real-money execution disabled</small></div>
    <div className="command-head-aside-foot"><span className="command-head-aside-dot"/> CONTROLLED ENVIRONMENT <span>·</span> READ ONLY</div>
   </aside>
  </section>
  <section className="command-snapshot" aria-label="System snapshot">
   <div className="command-section-kicker"><span>01</span><div><strong>System snapshot</strong><small>Latest recorded operating signals</small></div></div>
   <Suspense fallback={<StripFallback/>}><CommandStrip/></Suspense>
  </section>
  <div className="command-main">
   <section className="command-chat command-workspace" aria-label="SportsEdge assistant workspace">
    <div className="command-workspace-head"><div><span className="command-workspace-kicker">INTELLIGENCE INTERFACE</span><h2>Ask SportsEdge</h2><p>Query your recorded data, challenge a model, or trace an automated decision.</p></div><span className="command-workspace-state"><i/> READY FOR INPUT</span></div>
    <AssistantChat starters={HOME_STARTERS} intro="I'm connected to your SportsEdge records. What should we investigate?"/>
    <p className="quiet small-print command-shortcuts">DIRECT ACCESS <span>·</span> <Link href="/lab">AI Learning Lab</Link> <span>·</span> <Link href="/paper-betting/props">Sports props</Link> <span>·</span> <Link href="/paper-betting/watch">Watch Only</Link> <span>·</span> <Link href="/stocks/paper-auto">Stock autopilot</Link> <span>·</span> <Link href="/automation">Automation</Link> <span>·</span> <Link href="/prediction-markets/kalshi">Kalshi research</Link></p>
   </section>
   <div className="command-rail">
    <div className="command-rail-kicker"><span>02</span><div><strong>Operations monitor</strong><small>System health and approvals</small></div></div>
    <Suspense fallback={<Panel title="Right now" className="status-panel"><Skeleton lines={5}/></Panel>}><BriefingNow/></Suspense>
   </div>
  </div>
  <section className="command-briefing" aria-label="Performance briefing">
   <div className="command-section-kicker"><span>03</span><div><strong>Performance briefing</strong><small>Today, recorded outcomes, upcoming runs, and model learning</small></div></div>
   <Suspense fallback={<BoardFallback/>}><BriefingBoard/></Suspense>
  </section>
 </div>;
}
