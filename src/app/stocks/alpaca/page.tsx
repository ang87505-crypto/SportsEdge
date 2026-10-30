import {PageHeading,Evidence,Badge} from '@/components/ui';
import {NavIcon} from '@/components/nav-icon';
import {AlpacaPaperDashboard} from '@/components/alpaca-paper-dashboard';

export const metadata={title:'Paper account & orders · Stocks · SportsEdge'};
export default function AlpacaAccountPage(){
  return <>
    <PageHeading title="Paper account & orders"
      description="Broker-reported balances, positions and orders from your Alpaca PAPER account, with the safety gates that sit in front of any simulated order. Scheduled trading stays off."
      meta={<><Evidence kind="broker"/><Badge tone="neutral">Owner-only</Badge></>}/>
    <div className="virtual-banner" role="note">
      <span className="virtual-banner-icon"><NavIcon name="shield" size={18}/></span>
      <div><strong>Alpaca PAPER, not a brokerage account with real money.</strong> Fills are simulated by Alpaca. These balances are separate from the practice journal and are not strategy returns.</div>
    </div>
    <AlpacaPaperDashboard/>
  </>;
}
