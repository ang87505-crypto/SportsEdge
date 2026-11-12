import {Suspense} from 'react';
import {Panel,Skeleton} from '@/components/ui';
import {HomeView} from '@/components/home-view';
import {PropsStatusRow} from '@/components/props-home';
import {BriefingNow,BriefingBoard} from '@/components/briefing-home';

function BoardFallback(){
 return <div className="home-grid briefing-grid">
  {['Today','Results','Next'].map(t=><Panel key={t} title={t}><Skeleton lines={4}/></Panel>)}
 </div>;
}

export default function Home(){
 return <HomeView
  rightNow={<Suspense fallback={<Panel title="Right now" className="status-panel"><Skeleton lines={5}/></Panel>}><BriefingNow/></Suspense>}
  board={<Suspense fallback={<BoardFallback/>}><BriefingBoard/></Suspense>}
  propsStatus={<Suspense fallback={null}><PropsStatusRow/></Suspense>}/>;
}
