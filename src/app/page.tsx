import {Suspense} from 'react';
import Link from 'next/link';
import {Panel,Skeleton} from '@/components/ui';
import {AssistantChat} from '@/components/assistant-chat';
import {CommandStrip} from '@/components/command-strip';
import {BriefingNow,BriefingBoard} from '@/components/briefing-home';
import {CommandInsights} from '@/components/command-insights';

const HOME_STARTERS=['How did our picks do yesterday?','Compare this week with last week','Show active experiments','How much did we make yesterday?',"How did all our predictions do yesterday, including ones we didn't bet?",'What did our AI learn?','Why did we choose this lineup?',"Why didn't we trade?",
 'Which features actually improve our predictions?','How accurate are our 80% predictions actually?','Would flat staking have performed better?','Is everything running?'];

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
   <h1 id="home-title">Ask SportsEdge</h1>
   <p>Ask anything about the virtual picks, the stock PAPER account, what the AI has learned, or the automation. Every answer comes from saved records. Nothing here uses real money.</p>
  </section>
  <Suspense fallback={<StripFallback/>}><CommandStrip/></Suspense>
  <div className="command-main">
   <div className="command-chat">
    <AssistantChat endpoint="/api/command" starters={HOME_STARTERS} intro="What would you like to know? Pick a question or type your own."/>
    <p className="quiet small-print">Also: <Link href="/lab">AI Learning Lab</Link> · <Link href="/paper-betting/props">PrizePicks picks</Link> · <Link href="/stocks/paper-auto">Stock autopilot</Link> · <Link href="/automation">Automation</Link></p>
   </div>
   <div className="command-rail">
    <Suspense fallback={<Panel title="Right now" className="status-panel"><Skeleton lines={5}/></Panel>}><BriefingNow/></Suspense>
   </div>
  </div>
  <Suspense fallback={<BoardFallback/>}><BriefingBoard/></Suspense>
  <Suspense fallback={null}><CommandInsights/></Suspense>
 </div>;
}
