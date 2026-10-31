import {PageHeading} from '@/components/ui';
import {PaperAutoOperations} from '@/components/paper-auto-operations';

export const metadata={title:'Autopilot · Stocks · SportsEdge',
 description:'Start, stop and follow the weekly stock autopilot on the Alpaca paper account.'};
export default function PaperAutoPage(){
  return <>
    <PageHeading title="Autopilot"
      description="Picks stocks every Monday and trades them on your Alpaca paper account. Paper money only; Stop works at any time."/>
    <PaperAutoOperations/>
  </>;
}
