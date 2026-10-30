import Link from 'next/link';
import {Panel} from '@/components/ui';
import {SECTIONS} from '@/lib/navigation';

export default function NotFound(){
 return <div className="status-page">
  <Panel>
   <div className="status-page-body">
    <span className="status-page-code">404</span>
    <h1>Page not found</h1>
    <p>This address does not match a SportsEdge page. It may have moved; the practice journal now lives under Stocks.</p>
    <div className="button-row">{SECTIONS.map(s=><Link key={s.href} href={s.href} className={s.id==='overview'?'button':'button button-secondary'}>{s.label}</Link>)}</div>
   </div>
  </Panel>
 </div>;
}
