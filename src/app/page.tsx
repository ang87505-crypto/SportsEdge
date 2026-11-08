import {Suspense} from 'react';
import {Panel,Skeleton} from '@/components/ui';
import {HomeView} from '@/components/home-view';
import {PropsHomeCard,PropsStatusRow} from '@/components/props-home';

export default function Home(){
 return <HomeView
  propsCard={<Suspense fallback={<Panel title="PrizePicks" description="Daily NBA player props · $5 virtual entries"><Skeleton lines={4}/></Panel>}><PropsHomeCard/></Suspense>}
  propsStatus={<Suspense fallback={null}><PropsStatusRow/></Suspense>}/>;
}
