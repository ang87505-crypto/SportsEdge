import Link from 'next/link';
import {PageHeading,Panel,Evidence,KeyValues} from '@/components/ui';

/**
 * Research preview only. NO API call, credentials, order, account or live data.
 * Deliberately no automatic market preview until data-use authorization is reviewed.
 */
export const metadata={title:'Prediction markets research · SportsEdge',
 description:'Kalshi integration research status; no live collection or real-money trading.'};

export default function PredictionMarketsKalshiPage(){
 return <>
  <PageHeading title="Prediction markets research"
   description="Kalshi weather and economics research is being developed separately from SportsEdge's live sports and stock PAPER systems."
   action={<Link className="button button-secondary" href="/">Back to command center</Link>}/>
  <div className="virtual-banner" role="note"><strong>Research prototype only.</strong> No Kalshi account connected.
   No live quotes, orders, deposits, real-money trades or authenticated exchange actions.</div>
  <Panel title="Kalshi integration" actions={<Evidence kind="unavailable"/>}>
   <p>Offline market data normalization, tentative fee-aware paper forecasts, strict settlement grading and
    research evaluation have been implemented on a draft branch. No forward evidence is available yet,
    and no Kalshi data is being collected by this page.</p>
   <KeyValues items={[
    ['Market data','Code-only; live access disabled pending rights review'],
    ['Candidate first category','NYC weather, research only'],
    ['Independent forecast source','NWS hourly grid API; not the official station result'],
    ['Trading','Disabled — no credentials or trade endpoint'],
    ['Production schedule','None'],
    ['Profitability','Unmeasured; no proven edge'],
    ['New Mexico eligibility','Sports contracts contested; not approved for real-money use']
   ]}/>
  </Panel>
  <Panel title="What must happen before activation" className="mt-12">
   <p>Kalshi&apos;s Data Terms restrict software/AI use of its data without prior written permission.
    A public API endpoint is not proof that those uses are licensed. Written permission or a
    separate applicable authorized API-data license must be verified before collection,
    modeling, storage, or public display is enabled.</p>
   <p>Only after that review can we verify a sample of live prices, pair those quotes with
    independently timed forecasts, paper-grade settlements, and evaluate costs, calibration
    and distinct events. Paper results must not be mistaken for real fills.</p>
   <p><a href="https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf"
    target="_blank" rel="noreferrer">Read Kalshi&apos;s published data terms</a></p>
  </Panel>
 </>;
}
