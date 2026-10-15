import Link from 'next/link';
import {PageHeading} from '@/components/ui';
import {AlpacaPaperDashboard} from '@/components/alpaca-paper-dashboard';

export const metadata={title:'Private Alpaca Paper Account · SportsEdge'};
export default function AlpacaAccountPage(){
  return <>
    <PageHeading eyebrow="STOCKS / BROKER CONNECTION" title="Your Alpaca paper account."
      description="Inspect broker-reported virtual balances and order history, review safety gates, and prepare a separately owner-authorized one-order PAPER test. Scheduled trading stays off."
      action={<Link className="button button-secondary" href="/stocks">← Stock workspace</Link>}/>
    <AlpacaPaperDashboard/>
  </>;
}
