import Link from 'next/link';
import {PageHeading} from '@/components/ui';
import {AlpacaPaperDashboard} from '@/components/alpaca-paper-dashboard';

export const metadata={title:'Private Alpaca Paper Account · SportsEdge'};
export default function AlpacaAccountPage(){
  return <>
    <PageHeading eyebrow="STOCKS / BROKER CONNECTION" title="Your Alpaca paper account."
      description="View real broker-reported virtual balances, positions, and recent orders from your private, read-only SportsEdge dashboard."
      action={<Link className="button button-secondary" href="/stocks">← Stock workspace</Link>}/>
    <AlpacaPaperDashboard/>
  </>;
}
