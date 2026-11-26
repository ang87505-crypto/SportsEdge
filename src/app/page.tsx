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
   <p className="command-kicker">SPORTSEDGE / RESEARCH OPERATIONS</p>
   <h1 id="home-title">Command center</h1>
   <p>Follow sports, stock PAPER, weather research and model learning. Ask for results, status or next steps.</p>
  </section>
  <Suspense fallback={<StripFallback/>}><CommandStrip/></Suspense>
  <div className="command-main">
   <div className="command-chat">
    <AssistantChat starters={HOME_STARTERS} intro="What would you like to know? Pick a question or type your own."/>
    <p className="quiet small-print">Also: <Link href="/lab">AI Learning Lab</Link> · <Link href="/paper-betting/props">PrizePicks picks</Link> · <Link href="/paper-betting/watch">Watch Only (no bets)</Link> · <Link href="/stocks/paper-auto">Stock autopilot</Link> · <Link href="/automation">Automation</Link> · <Link href="/prediction-markets/kalshi">Kalshi research</Link></p>
   </div>
   <div className="command-rail">
    <Suspense fallback={<Panel title="Right now" className="status-panel"><Skeleton lines={5}/></Panel>}><BriefingNow/></Suspense>
   </div>
  </div>
  <Suspense fallback={<BoardFallback/>}><BriefingBoard/></Suspense>
 </div>;
}
