import Link from 'next/link';
import {Suspense} from 'react';
import {connection} from 'next/server';
import {PageHeading,Panel,Evidence,KeyValues} from '@/components/ui';
import {loadLatestIndependentWeather,loadLatestWeatherScorecard} from '@/lib/prediction-markets/kalshi/weather-memory-view';
import {KalshiPaperPanel} from '@/components/kalshi-paper-panel';

/**
 * Only independent archived NOAA weather data is read from the research-data branch.
 * Public panels read NOAA only. The separate owner panel reads private paper records.
 */
export const metadata={title:'Prediction markets research · SportsEdge',
 description:'Independent weather research, private paper records and demo readiness. Production trading is disabled.'};

async function IndependentWeatherPanels(){
 // Read current time only at request time, never while Cache Components prerenders.
 await connection();
 const asOf=new Date().toISOString();
 const [archive,scorecard]=await Promise.all([loadLatestIndependentWeather(asOf),loadLatestWeatherScorecard(asOf)]);
 return <>
  <Panel title="Independent NYC weather forecast memory" actions={<Evidence kind={archive.state==='RECORDED'?'recorded':'unavailable'}/>}>
   {archive.state==='RECORDED'?<>
    <p>Archived from the public NWS hourly grid forecast, before the target weather day. The comparison uses
     the Central Park climate-report standard-time day. This is <strong>not a Kalshi contract prediction</strong>,
     price, settlement or real trade.</p>
    <KeyValues items={[
     ['Target Central Park climate date',archive.memory.targetLocalDate],
     ['Captured',archive.memory.capturedAt],
     ['NWS grid forecast high',String(archive.memory.forecastHighF)+'°F'],
     ['Independent experimental range',String(archive.memory.bandLowF)+'–'+String(archive.memory.bandHighF)+'°F'],
     ['Experimental range probability',archive.memory.estimatedBandProbabilityPpm===null?
      'Not available: awaiting independently verified history':
      (archive.memory.estimatedBandProbabilityPpm/10000).toFixed(1)+'% (NOT validated)'],
     ['Historical training pairs',String(archive.memory.historicalTrainingDays)],
     ['Next-morning NWS Central Park high',archive.grade?
      String(archive.grade.observedHighF)+'°F (PRELIMINARY; not certified)':'Awaiting archived full daily climate report'],
     ['Independent 5°F range check',archive.grade?
      (archive.grade.hitIndependentBand?'Inside range':'Outside range'):'Not graded'],
     ['Market prices','Not requested; rights review pending'],
     ['Kalshi requests used','0'],
    ]}/>
    <p className="quiet small-print">Each independent daily forecast and its eventual preliminary NWS
     climate report is saved once in the append-only research-data archive. Revisiting this page
     reads stored files, not Kalshi or NWS endpoints.</p>
   </>:<p>{archive.state==='ARCHIVE_UNAVAILABLE'?
    'The independent NWS research archive could not be verified right now. No forecast or win rate is inferred.':
    'Awaiting the first independently captured NWS forecast after the owner-approved research workflow is released. No market data is being requested.'}</p>}
   <p><a href="https://github.com/ang87505-crypto/SportsEdge/tree/research-data/kalshi-independent/nyc-weather"
    target="_blank" rel="noreferrer">View archived independent NOAA evidence</a></p>
  </Panel>
  <Panel title="Independent forward forecast scorecard" actions={<Evidence kind={scorecard.state==='RECORDED'?'recorded':'unavailable'}/>}>
   {scorecard.state==='RECORDED'?<>
    <KeyValues items={[
     ['Distinct climate days evaluated',String(scorecard.scorecard.evaluatedDays)],
     ['Mean temperature forecast error',scorecard.scorecard.meanAbsoluteErrorF===null?'Not measured':
      scorecard.scorecard.meanAbsoluteErrorF.toFixed(1)+'°F'],
     ['Independent 5°F-range coverage',scorecard.scorecard.independentBandHitRate===null?'Not measured':
      (scorecard.scorecard.independentBandHitRate*100).toFixed(1)+'% (NOT bets)'],
     ['Calibrated probabilities evaluated',String(scorecard.scorecard.modelScoredDays)],
     ['Experimental model Brier score',scorecard.scorecard.modelBrier===null?
      'Insufficient trained forward probabilities':scorecard.scorecard.modelBrier.toFixed(4)],
     ['Evidence status',scorecard.scorecard.status==='INSUFFICIENT_HISTORY'?'Insufficient history':
      'Exploratory only — no verified Kalshi edge'],
    ]}/>
    <p className="quiet small-print">These comparisons use preliminary NWS climate reports, not final Kalshi
     contract results. They represent weather forecasting evidence only and never count as orders, fills or profit.</p>
   </>:<p>{scorecard.state==='ARCHIVE_UNAVAILABLE'?
    'The archived independent scorecard could not be verified. No accuracy or trading results are inferred.':
    'There are not yet completed archived government forecast/outcome pairs to summarize.'}</p>}
  </Panel>
 </>;
}
export default function PredictionMarketsKalshiPage(){
 return <>
  <PageHeading title="Kalshi research and paper"
   description="Follow independent weather forecasts, paper-system checks and your separate exchange demo account."
   action={<Link className="button button-secondary" href="/">Back to command center</Link>}/>
  <div className="virtual-banner" role="note"><strong>Research and demo only.</strong> Production exchange access is disabled.
   Demo connection status and any mock-fund orders appear in the owner workspace.</div>
  <KalshiPaperPanel/>
  <Suspense fallback={<Panel title="Independent NOAA weather memory">
    <p>Checking stored public weather research; no Kalshi API request is made.</p>
   </Panel>}>
    <IndependentWeatherPanels/>
  </Suspense>
  <Panel title="Kalshi integration" actions={<Evidence kind="unavailable"/>}>
   <p>The platform records independent NOAA research and offers a separate owner-controlled demo connection. The public weather panels use no exchange data. Production exchange-data access remains disabled pending authorization for the intended use.</p>
   <KeyValues items={[
    ['Market data','Code-only; live access disabled pending rights review'],
    ['First research categories','NYC weather and US CPI, offline research only'],
    ['Independent weather replay','Chronological NWS forecasts vs verified station highs; no market input'],
    ['Independent CPI source','BLS CPI-U current published series; release vintages not reconstructed'],
    ['Independent forecast source','NWS hourly grid API; not the official station result'],
    ['Production trading','Disabled'],
    ['Demo trading','Requires separate credentials, reviewed access and owner Start'],
    ['Paper worker','Daily research updates; model demo orders only while armed and eligible'],
    ['Independent NOAA schedule','Active; government-source research only'],
    ['Profitability','Unmeasured; no proven edge'],
    ['Initial demo scope','NYC daily high temperature only']
   ]}/>
  </Panel>
  <Panel title="What must happen before activation" className="mt-12">
   <p>Kalshi&apos;s Data Terms restrict software/AI use of its data without prior written permission.
    A public API endpoint is not proof that those uses are licensed. Written permission or a
    separate applicable authorized API-data license must be verified before collection,
    modeling, storage, or public display is enabled.</p>
   <p>Independent NOAA/NWS weather forecasts and BLS CPI observations can be studied without Kalshi data. Real historical as-of forecasts and original release vintages remain prerequisites for meaningful backtests. Only after permission review can we verify a sample of live prices, pair those quotes with
    independently timed forecasts, paper-grade settlements, and evaluate costs, calibration
    and distinct events. Paper results must not be mistaken for real fills.</p>
   <p><a href="https://kalshi-public-docs.s3.amazonaws.com/kalshi-data-terms-of-service.pdf"
    target="_blank" rel="noreferrer">Read Kalshi&apos;s published data terms</a></p>
  </Panel>
 </>;
}
