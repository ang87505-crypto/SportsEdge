import Link from 'next/link';
import {connection} from 'next/server';
import {PageHeading,Panel,Metric,MetricGrid,Badge,Callout,Evidence,Details,type Tone} from '@/components/ui';
import {loadLab} from '@/lib/server/lab-load';
import {VERDICT_TEXT,type LabView} from '@/lib/lab/view';
import {METHOD_TEXT,type Method} from '@/lib/lab/staking';
import {engineView} from '@/lib/lab/engine/view';
import {loadResearchEngine} from '@/lib/server/research-engine-load';
import type {SportsScorecard,ProbabilitySummary} from '@/lib/lab/engine/scorecard';
import {PENNY_EXAMPLES,PENNY_POLICY} from '@/lib/lab/confidence-sizing';
import {loadResearchIntake} from '@/lib/server/research-intake-load';
import {loadPennyPaper} from '@/lib/server/penny-paper-load';
import {PENNY_PAPER_POLICY} from '@/lib/lab/penny-paper';

export const metadata={title:'AI Learning Lab | SportsEdge',description:'What the SportsEdge models have measurably learned, what is still a hypothesis, and what is being tested.'};

const pct=(x:number|null|undefined,d=1)=>x===null||x===undefined?'—':(x*100).toFixed(d)+'%';
const money=(c:number)=>(c<0?'−':'')+'$'+(Math.abs(c)/100).toFixed(2);
const signed=(x:number|null)=>x===null?'—':(x>0?'+':'')+x.toFixed(5);
const TONE:Record<string,Tone>={helps:'positive',hurts:'negative',no_clear_effect:'neutral',collecting:'info',not_tested:'neutral'};
const STATUS:Record<string,{text:string;tone:Tone}>={not_migrated:{text:'Built; waiting for the owner to apply props_lab_v1.sql',tone:'warning'},
 not_configured:{text:'Not connected in this deployment',tone:'neutral'},unavailable:{text:'Forward records unavailable right now',tone:'negative'},
 awaiting_first_report:{text:'Recording; first report after the next morning settle',tone:'info'},collecting:{text:'Collecting forward evidence',tone:'info'},
 sample_minimums_met:{text:'Forward minimums met',tone:'positive'}};

function Table({head,rows}:{head:string[];rows:React.ReactNode[][]}){
 return <div className="chat-table-scroll"><table className="chat-table lab-table">
  <thead><tr>{head.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead>
  <tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=>j===0?<th key={j} scope="row">{c}</th>:<td key={j}>{c}</td>)}</tr>)}</tbody>
 </table></div>;
}

export default async function LabPage(){
 await connection();
 const v:LabView=await loadLab();
 const st=STATUS[v.forwardStatus]??STATUS.unavailable;
 const f0=v.retroVariants[0],f1=v.retroVariants[1];
 return <div className="page lab-page">
  <PageHeading title="AI Learning Lab" description="Every predictive layer is tested with and without itself on the same frozen lines. Retrospective results rank ideas; only forward results, frozen before lock, can promote anything."
   meta={<Badge tone={st.tone}>{st.text}</Badge>}/>
  <MetricGrid columns={4}>
   <Metric label="Active model" value={v.active?.version??'Unknown'} detail={v.active?`Learning ${v.active.learningEnabled?'on':'off'} · auto-switch ${v.active.autoSwitchEnabled?'on':'off'}`:'Production control not readable here'}/>
   <Metric label="Being tested" value={`${v.testing.productionShadows.length} + ${v.testing.labVariants}`} detail={`${v.testing.productionShadows.length} production shadow(s) (limit 3) + ${v.testing.labVariants} lab variants`}/>
   <Metric label="Ablation lab graded lines" value={v.samples.forward?String(v.samples.forward.graded):'—'} detail={`Needs ${v.samples.minimums.lines} lines, ${v.samples.minimums.dates} dates, ${v.samples.minimums.games} games`}/>
   <Metric label="Research cost" value={`${v.costs.paidRequests} credits`} detail="Reuses stored lines and quotes"/>
  </MetricGrid>

  <Panel title="Each layer's measured contribution" description="Brier change when the layer is added (negative = better), with Holm-adjusted significance across the whole experiment" actions={<Evidence kind="historical"/>}>
   <Table head={['Layer','2025-26 second half','2026-27 to date','Forward']} rows={v.layers.map(l=>[l.label,
    ...l.retro.map((r,i)=><span key={i}><Badge tone={TONE[r.verdict]}>{VERDICT_TEXT[r.verdict]}</Badge> {r.verdict==='not_tested'?'':<small className="quiet">{signed(r.brierChange)} [{signed(r.lower95)}, {signed(r.upper95)}]</small>}</span>),
    l.forward?<Badge tone={TONE[l.forward.verdict]}>{VERDICT_TEXT[l.forward.verdict]}</Badge>:<span className="quiet">—</span>])}/>
   <p className="home-panel-note">Training and test sizes: {v.samples.retro.map(s=>`${s.fold.replace(/^fold\d-/,'')}: ${s.trainRows.toLocaleString()} training / ${s.testRows.toLocaleString()} test lines`).join(' · ')}. Leakage checks: {v.leakage.checked.toLocaleString()} inputs, {v.leakage.violations} violations.</p>
  </Panel>

  <div className="home-grid">
   <Panel title="Model comparison" description="Same lines, every variant (retrospective, proxy lines)">
    <Table head={['Variant','Brier','Log loss','Calibration error','Picks hit']} rows={(f0?.variants??[]).map((x,i)=>[x.label,
     <span key="b">{x.brier?.toFixed(4)} <small className="quiet">/ {f1?.variants[i]?.brier?.toFixed(4)??'—'}</small></span>,x.logLoss?.toFixed(4),pct(x.ece),`${pct(x.decisionHitRate)} of ${x.decisions.toLocaleString()}`])}/>
    <p className="home-panel-note">First number: 2025-26 second half; after the slash: 2026-27 to date. Lower is better for every column except hit rate. Hit rate never decides promotion.</p>
   </Panel>
   <Panel title="Repeated mistakes" description={`From ${v.mistakes?.picks.toLocaleString()??0} ${v.mistakes?.source??''} picks`}>
    {v.mistakes?<Table head={['Pattern','Misses','× vs hits','Known before lock?']} rows={v.mistakes.patterns.map(p=>[p.what,String(p.misses),p.lift===null?'—':`${p.lift}×`,<small key="p">{p.preLock}</small>])}/>:<p className="quiet">No diagnosis stored yet.</p>}
   </Panel>
  </div>

  <Panel title="Pre-decision warnings (research only)" description="Recorded before lock beside each line; never applied to picks. Would skipping flagged picks have helped?">
   {v.warnings?<Table head={['Warning','Flagged picks','Hit rate flagged / not','Skip avoids / rejects good','Verdict']} rows={v.warnings.effects.filter(e=>e.flagged>0).map(e=>[e.text,e.flagged.toLocaleString(),
    `${pct(e.flaggedHitRate)} / ${pct(e.unflaggedHitRate)}`,`${e.missesAvoided} / ${e.goodRejected}`,<Badge key="v" tone={e.verdict==='would_help'?'positive':'neutral'}>{e.verdict.replaceAll('_',' ')}</Badge>])}/>:null}
   <p className="home-panel-note">{v.coverageGaps.join(' ')} Break-even for a 2-pick Power Play is 57.7% per pick.</p>
  </Panel>

  <Panel title="Variable PAPER staking (shadow only)" description={v.staking.live} actions={<Evidence kind="simulated"/>}>
   <Details title="Penny-per-percentage-point sizing proposal">
    <p className="home-panel-note">One cent for each complete percentage point above break-even. This table uses a hypothetical even-money payout with a 50% break-even point. For a multi-leg entry, use the whole-entry probability and its recorded payout, not one leg&apos;s confidence.</p>
    <Table head={['Probability','Proposed virtual stake']} rows={PENNY_EXAMPLES.map(x=>[`${x.percent}%`,money(x.stakeCents)])}/>
    <p className="home-panel-note">Reference mapping: {PENNY_POLICY.version}. The separate penny paper study below shows its actual setup state and frozen virtual amounts. Existing paper accounts keep their fixed stakes. Higher stated confidence can be wrong; these amounts do not establish calibrated probabilities.</p>
   </Details>
   {v.staking.retro?.folds.map(f=><div key={f.label} style={{marginBottom:12}}>
    <p className="chat-card-title">{f.label.replace(/^fold\d-/,'')} · {f.comparison.entries} entries, same for every method</p>
    <Table head={['Method','Staked / skipped','Virtual P&L','ROI','Max drawdown','Max day exposure']} rows={f.comparison.methods.map(m=>[METHOD_TEXT[m.method as Method].split(':')[0],
     `${m.staked} / ${m.skipped}`,money(m.pnlCents),pct(m.roi),pct(m.maxDrawdown),money(m.maxDailyExposureCents)])}/>
   </div>)}
   <p className="home-panel-note">{v.staking.forward?`Forward: ${v.staking.forward.settled} settled, ${v.staking.forward.pending} pending. `+v.staking.forward.verdicts.map(x=>`${METHOD_TEXT[x.method].split(':')[0]} ${x.verdict.replaceAll('_',' ')}`).join(' · '):'Forward shadow stakes: none settled yet.'} No method is called better than flat until {v.staking.gate.minSettledEntries} settled forward entries over {v.staking.gate.minDates} dates show a Holm-adjusted improvement. Retrospective rows use proxy lines.</p>
  </Panel>

  <PennyPaperPanel/>

  <div className="home-grid">
   <Panel title="Promotion status">
    <Callout tone={v.promotion.eligible?'positive':'neutral'} title={v.promotion.eligible?'A layer meets the requirements':'Nothing meets the promotion requirements'}>{v.promotion.why}</Callout>
   </Panel>
   <Panel title="Stock behaviour research" description="Separate stock AI: research only; never the live weekly strategy">
    <p className="home-panel-note">{v.stocks&&v.stocks.state==='ready'?v.stocks.summary:'Registered (market regime, attention spikes, volatility shocks, one-month overreaction); the nightly research run freezes weekly picks before each open and the first historical ablation runs on its next scheduled pass. No result yet. The weekly stock strategy and the Monday supervised PAPER release are unchanged.'}</p>
    {v.stocks?.verdicts?<ul className="evidence-list">{v.stocks.verdicts.map(x=><li key={x.layer}><span>{x.layer}{x.detail&&<><br/><small className="quiet">{x.detail}</small></>}</span><Badge tone={x.verdict==='helps'?'positive':x.verdict==='hurts'?'negative':'neutral'}>{x.label}</Badge></li>)}</ul>:null}
   </Panel>
   <Panel title="History, failed and rejected experiments">
    <ul className="evidence-list">{v.history.earlier.map(e=><li key={e.id}><span><strong>{e.id}</strong><br/><small className="quiet">{e.why}</small></span><Badge tone={e.outcome==='rejected'?'negative':e.outcome==='withdrawn'?'warning':'info'}>{e.outcome}</Badge></li>)}</ul>
    <Details title={`Production model events (${v.history.production.length})`}>
     <ul className="evidence-list">{v.history.production.map((e,i)=><li key={i}><span>{e.version} · {e.reason}</span><Badge>{e.event}</Badge></li>)}</ul>
    </Details>
   </Panel>
  </div>
  <EnginePanel/>
  <ResearchIntakePanel/>
  <Details title="Method and caveats">
   <ul>{v.caveats.map(c=><li key={c}>{c}</li>)}</ul>
   <p className="quiet small-print">Spec {v.specSha256.slice(0,12)}… · artifact {v.artifactSha256.slice(0,12)}… · Ask about any of this on the <Link href="/">home page</Link>.</p>
  </Details>
 </div>;
}

async function PennyPaperPanel(){
 const snapshot=await loadPennyPaper(),s=snapshot.summary;
 const label={not_migrated:'Database setup required',not_configured:'Not connected in this deployment',awaiting_registration:'Awaiting first worker registration',ready:'Forward virtual study',unavailable:'Study records unavailable'}[snapshot.state];
 return <Panel title="Penny paper study" description="Separate virtual accounts: probability-sized entries versus the same entries at a flat $0.10." actions={<Evidence kind="simulated"/>}>
  <Callout tone={snapshot.state==='ready'?'info':'warning'} title={label}>
   {s?`Registered ${snapshot.cohort!.registered_at}. ${s.entries} frozen entries; ${s.settled} graded; ${s.pending} pending. `:
    snapshot.state==='not_migrated'?'The study tables are missing. No cent-sized stakes have been recorded. ':snapshot.state==='awaiting_registration'?'Tables exist; collection begins when the worker registers this new cohort. ':'Current records are unavailable. '}
   Stakes use the recorded model estimates for the complete two-pick entry, with a fixed 2% dependence haircut. These estimates are uncalibrated; the haircut is a research assumption. Nothing is promoted from this study.
  </Callout>
  {s?<>
   <Table head={['Virtual account','Available','Reserved on open entries','Realized profit','Total staked','Max daily exposure']} rows={[
    ['Probability-sized',money(s.variable.availableCents),money(s.variable.openStakeCents),money(s.variable.realizedProfitCents),money(s.variable.totalStakedCents),money(s.variable.maxDailyExposureCents)],
    ['Flat $0.10 reference',money(s.reference.availableCents),money(s.reference.openStakeCents),money(s.reference.realizedProfitCents),money(s.reference.totalStakedCents),money(s.reference.maxDailyExposureCents)]
   ]}/>
   <Details title="Latest frozen penny entries">
    <Table head={['Source entry','Whole-entry estimate','Penny stake','Flat reference','Current result','Penny profit']} rows={s.recent.map(e=>[
     '#'+e.source_entry_id,e.probability_ppm===null?'Unknown':pct(e.probability_ppm/1_000_000),money(e.stake_cents),money(e.reference_stake_cents),
     e.settlement?`${e.settlement.outcome.replaceAll('_',' ')} · revision ${e.settlement.revision}`:e.stake_cents?'Pending':e.reason.toLowerCase().replaceAll('_',' '),
     e.settlement?.profit_cents===null||!e.settlement?'—':money(e.settlement.profit_cents)
    ])}/>
   </Details>
  </>:<p className="home-panel-note">Setup: <a href="https://github.com/ang87505-crypto/SportsEdge/blob/main/database/props/forward_studies_setup.sql" target="_blank" rel="noreferrer">reviewable database setup</a>. Missing evidence is shown as unavailable.</p>}
  <p className="home-panel-note">Policy {PENNY_PAPER_POLICY.id}. Each virtual account starts at $500; variable stake cap $0.50; daily exposure cap $15. Only future entries from the registration onward can enter. Unknown payouts and same-game dependence produce no stake. Fractional-cent returns round down under this virtual experiment&apos;s rule. Calibration and payout assumptions can outweigh a higher stated confidence.</p>
 </Panel>;
}

const ENGINE_TONE:Record<string,Tone>={RUNNING:'info',PROPOSED:'neutral',INSUFFICIENT_DATA:'warning',PROMISING:'positive',FAILED:'negative',READY_FOR_REVIEW:'positive',REJECTED:'negative'};
async function EnginePanel(){
 const snapshot=await loadResearchEngine(new Date().toISOString());
 const e=engineView(snapshot.registry,snapshot.jobs);
 const line=(d:'sports'|'stocks'|'weather')=>Object.entries(e.counts[d]).filter(([,n])=>n).map(([s,n])=>`${s.replaceAll('_',' ').toLowerCase()} ${n}`).join(' · ');
 return <Panel title="Learning engine (research only)" description="Every registered experiment, from the recorded registry. Nothing here changes a model, pick, stake or order; a ready experiment waits for the owner." actions={<Evidence kind="recorded"/>}>
  <Callout tone={snapshot.mode!=='live'||snapshot.stale||snapshot.status!=='OK'?'warning':'info'} title={snapshot.mode==='live'?'Published evaluation':'Saved research snapshot'}>
   {snapshot.at?`Recorded ${snapshot.at}. `:''}{snapshot.detail} Production-shadow comparisons below use predictions already saved before lock; they are separate from the nine-variant ablation lab above.
  </Callout>
  {snapshot.scorecard?<ProbabilityScorecard value={snapshot.scorecard}/>:<p className="home-panel-note">Detailed probability diagnostics will appear after an evaluation publishes the scorecard. Historical reports are retained.</p>}
  {snapshot.attention&&(snapshot.attention.gaps.length||snapshot.attention.alarms?.codes.length||snapshot.attention.withoutProducer.length)?
   <Callout tone="warning" title="Needs attention (from the latest evaluation)">
    <ul className="quiet">{snapshot.attention.alarms?.details.map((d,i)=><li key={'a'+i}><strong>{snapshot.attention!.alarms!.codes[i]?.replaceAll('_',' ').toLowerCase()}</strong>: {d}</li>)}
     {snapshot.attention.gaps.map(g=><li key={g.code}><strong>{g.code.replaceAll('_',' ').toLowerCase()}</strong>: {g.detail}</li>)}
     {snapshot.attention.withoutProducer.length?<li><strong>no automatic evidence producer yet ({snapshot.attention.withoutProducer.length})</strong>: {snapshot.attention.withoutProducer.join(', ')}. These advance only when the owner records a result.</li>:null}</ul>
    Review requests only; nothing here changes a model, pick, stake or order.
   </Callout>:null}
  {snapshot.drift?<Callout tone={snapshot.drift.status==='REVIEW_REQUESTED'?'warning':'info'} title={`Adaptation watch: ${snapshot.drift.status.replaceAll('_',' ').toLowerCase()}`}>
   {snapshot.drift.reason} Recent 7 days: {snapshot.drift.recent.lines} lines / {snapshot.drift.recent.games} games. Previous 28 days: {snapshot.drift.reference.lines} lines / {snapshot.drift.reference.games} games. Alerts request review; training and promotion remain separate.
  </Callout>:null}
  <MetricGrid columns={3}>
   <Metric label="Experiments recorded" value={String(e.total)} detail={`Sports: ${line('sports')}${line('weather')?` · Weather: ${line('weather')}`:''}`}/>
   <Metric label="Ready for owner review" value={String(e.readyForReview.length)} detail="Needs forward evidence meeting the registered minimums"/>
   <Metric label="Rejected and remembered" value={String(e.rejected.length)} detail={`Stocks: ${line('stocks')}`}/>
  </MetricGrid>
  {e.whyNoCandidate?<p className="home-panel-note"><strong>Why nothing qualifies yet:</strong> {e.whyNoCandidate}</p>:null}
  {e.forward.map(f=><div key={f.id}>
   <p className="small-print"><strong>Forward test: {f.candidate}</strong> vs {f.baseline} (frozen predictions before lock, production review gate) <Badge tone={ENGINE_TONE[f.status]}>{f.status.replaceAll('_',' ').toLowerCase()}</Badge></p>
   <ul className="evidence-list">{f.progress.map(p=><li key={p.label}><span>{p.label}</span><span><strong>{p.have??'—'}</strong> / {p.need}</span></li>)}</ul>
  </div>)}
  {e.readyForReview.length?<ul className="evidence-list">{e.readyForReview.map(x=><li key={x.id}><span><strong>{x.id}</strong><br/><small className="quiet">{x.why}</small></span><Badge tone="positive">ready for review</Badge></li>)}</ul>:null}
  <Details title={`Still collecting evidence (${e.collecting.length})`}>
   <ul className="evidence-list">{e.collecting.map(x=><li key={x.id}><span><strong>{x.id}</strong> <small className="quiet">({x.domain})</small><br/><small className="quiet">{x.why}</small></span><Badge tone={ENGINE_TONE[x.status]}>{x.status.replaceAll('_',' ').toLowerCase()}</Badge></li>)}</ul>
  </Details>
  <Details title={`Rejected ideas (${e.rejected.length}); never retested automatically`}>
   <ul className="evidence-list">{e.rejected.map(x=><li key={x.id}><span><strong>{x.id}</strong> <small className="quiet">({x.domain})</small><br/><small className="quiet">{x.why}</small></span><Badge tone="negative">rejected</Badge></li>)}</ul>
  </Details>
  <Details title={`Job history (${e.jobs.length})`}>
   <ul className="evidence-list">{e.jobs.map(j=><li key={j.run}><span><strong>{j.job}</strong> <small className="quiet">({j.at}, run {j.run})</small><br/><small className="quiet">{j.summary}</small></span><Badge tone={j.status==='OK'?'positive':'negative'}>{j.status}</Badge></li>)}</ul>
  </Details>
  <p className="home-panel-note">Research sources: connected {e.sources.connected.length} ({e.sources.connected.join(', ')}); built but not running {e.sources.implemented.join(', ')||'none'}; blocked {e.sources.blocked.join(', ')}; proposed {e.sources.proposed.join(', ')}. Evaluations read saved predictions after the props cycle and on a daily backup schedule. Research intake remains manual.</p>
 </Panel>;
}

async function ResearchIntakePanel(){
 const s=await loadResearchIntake(new Date().toISOString());
 return <Panel title="Research source memory" description="Dated collection receipts, provenance and a review queue; web text never changes a model directly.">
  <Callout tone={!s.receipt||s.stale||s.receipt.status!=='OK'?'warning':'info'} title={s.receipt?`${s.receipt.status} · ${s.receipt.at}`:'Awaiting a verified intake receipt'}>{s.detail}</Callout>
  {s.receipt?<>
   <MetricGrid columns={3}>
    <Metric label="Candidates for method review" value={String(s.receipt.reviewQueue)} detail="Metadata only; not validated findings"/>
    <Metric label="Quarantined leads" value={String(s.receipt.quarantined)} detail="Dates, relevance, withdrawals or unsafe text"/>
    <Metric label="Unchanged objects reused" value={String(s.receipt.objectsReused)} detail={`${s.receipt.objectsAdded} new content versions stored`}/>
   </MetricGrid>
   <ul className="evidence-list">{s.sources.map(x=><li key={x.id}><span>{x.id}</span><Badge tone={x.state==='VERIFIED_THIS_RUN'?'info':'warning'}>{x.state.replaceAll('_',' ').toLowerCase()}</Badge></li>)}</ul>
  </>:null}
  <p className="home-panel-note">Recent relevant literature is screened for timestamps, topic overlap and withdrawal flags. Indexing does not verify peer review or correctness. Durable content hashes avoid storing unchanged items twice; a reviewed rule and a pre-registered test are required before research can inform a model change.</p>
 </Panel>;
}

function ProbabilityScorecard({value}:{value:SportsScorecard}){
 const s=value.all;
 const interval=(x:ProbabilitySummary['brierDifference95'])=>x?`[${signed(x.lower95)}, ${signed(x.upper95)}]`:'Needs at least two games';
 return <div>
  <p className="chat-card-title">NBA probability scorecard</p>
  <MetricGrid columns={3}>
   <Metric label="Unique graded non-tie lines" value={String(s.lines)} detail={`${s.games} games · ${s.dates} dates`}/>
   <Metric label="Recorded picks correct" value={s.picks?`${s.hits} / ${s.picks}`:'—'} detail={`${pct(s.hitRate)} observed · ${pct(s.meanConfidence)} mean stated confidence`}/>
   <Metric label="Binary Brier / 50-50 reference" value={s.brier===null?'—':`${s.brier.toFixed(4)} / 0.2500`} detail={`Lower is better. Difference 95% interval: ${interval(s.brierDifference95)}`}/>
  </MetricGrid>
  <Details title="Where probability errors occur">
   {value.groups.map(g=><div key={g.id} style={{marginTop:12}}>
    <p className="small-print"><strong>{g.label}</strong></p>
    <Table head={['Group','Lines / games','Picks correct','Stated / observed','Brier','Brier − 50/50 (95% interval)','Sample']} rows={g.rows.map(b=>[
     b.label,`${b.summary.lines} / ${b.summary.games}`,b.summary.picks?`${b.summary.hits} / ${b.summary.picks}`:'—',
     `${pct(b.summary.meanConfidence)} / ${pct(b.summary.hitRate)}`,b.summary.brier?.toFixed(4)??'—',
     `${signed(b.summary.brierDifference)} ${interval(b.summary.brierDifference95)}`,b.summary.smallSample?'Small group':'Exploratory'
    ])}/>
   </div>)}
  </Details>
  <p className="home-panel-note">{value.note}</p>
 </div>;
}
