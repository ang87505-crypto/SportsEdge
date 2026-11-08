import {PageHeading} from '@/components/ui';
import {PaperAutoOperations} from '@/components/paper-auto-operations';
import Link from 'next/link';

export const metadata={title:'Autopilot · Stocks · SportsEdge',
 description:'Start, stop and follow the weekly stock autopilot on the Alpaca paper account.'};
export default function PaperAutoPage(){
  return <>
    <PageHeading title="Autopilot"
      description="Weekly stock picks, paper orders, and results. Start checks the account; Pause and Stop block new orders."
      action={<Link href="/automation" className="button button-secondary">Sports + stocks overview</Link>}/>
    <PaperAutoOperations/>
  </>;
}
