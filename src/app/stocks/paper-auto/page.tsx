import Link from 'next/link';
import {PageHeading} from '@/components/ui';
import {PaperAutoOperations} from '@/components/paper-auto-operations';

export const metadata={title:'Recurring Paper Operations · SportsEdge'};
export default function PaperAutoPage(){
  return <>
    <PageHeading eyebrow="STOCKS / RECURRING PAPER" title="Recurring paper trading operations."
      description="Owner-only status, STOP and forward evidence for the recurring Alpaca PAPER experiments. Broker observations, verified strategy P&L, backtests and research are kept apart."
      action={<Link className="button button-secondary" href="/stocks">← Stock workspace</Link>}/>
    <PaperAutoOperations/>
  </>;
}
