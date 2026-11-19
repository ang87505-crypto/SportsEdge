/**
 * AI 2.0 research intake: the source register. Pure data plus checks; no I/O.
 *
 * Every source the learning engine may use is listed with how it is accessed, what rights apply, what its timestamps
 * mean, and whether it is actually connected. "connected" means code in this repository already reads it in a job;
 * "implemented" means a tested parser/plan exists but no job runs it; "proposed" and "blocked" are never read.
 * Nothing here fetches anything, bypasses a paywall, scrapes a restricted page or buys data.
 */
export type SourceStatus='connected'|'implemented'|'proposed'|'blocked';
export type Reliability='official'|'regulatory'|'licensed-provider'|'public-dataset'|'peer-reviewed'|'secondary';
export type SourceEntry={id:string;domain:'sports'|'stocks'|'both';status:SourceStatus;reliability:Reliability;
 access:string;rights:string;availabilityTime:string;usedFor:string[];cost:string;blocker:string|null;whereInCode:string|null};

export const SOURCE_REGISTER:SourceEntry[]=[
 // ------------------------------------------------------------ sports
 {id:'the-odds-api',domain:'sports',status:'connected',reliability:'licensed-provider',access:'HTTPS API with the existing key (repository secret); budgeted 7 credits/24 h, 200/30 d',
  rights:'Paid plan already approved; terms permit programmatic use within the plan',availabilityTime:'provider last_update per bookmaker market; our ingested_at; refused at or after lock',
  usedFor:['PrizePicks/Pick6 lines','sportsbook quotes at the same line'],cost:'existing approved plan; no increase',blocker:null,whereInCode:'src/lib/server/props-odds-client.ts'},
 {id:'espn-box-scores',domain:'sports',status:'connected',reliability:'public-dataset',access:'Public ESPN summary JSON per event (no key)',
  rights:'Public endpoint; used for grading and history only, never republished',availabilityTime:'final box score after the game; grading waits for a final status',
  usedFor:['grading','player history'],cost:'free',blocker:null,whereInCode:'src/lib/server/props-espn-client.ts'},
 {id:'sportsdataverse-box-csv',domain:'sports',status:'connected',reliability:'public-dataset',access:'GitHub release files, hash-pinned per season',
  rights:'Open dataset (SportsDataverse, MIT-licensed tooling)',availabilityTime:'per-game start time; history uses only games before each cutoff (leakage-checked)',
  usedFor:['retrospective training and evaluation'],cost:'free',blocker:null,whereInCode:'scripts/lib/box-csv.ts'},
 {id:'nba-official-injury-report',domain:'sports',status:'blocked',reliability:'official',access:'League-published PDF reports several times a day',
  rights:'Terms of use for automated collection not yet reviewed by the owner',availabilityTime:'report publication time (in the PDF header); must precede lock',
  usedFor:['availability-aware minutes model (proposed)'],cost:'free',blocker:'Owner must review the terms of use; a PDF parser and a timestamped archive would be needed. Not collected, so injury/rotation features stay untested.',whereInCode:null},
 {id:'nba-stats-lineups',domain:'sports',status:'blocked',reliability:'official',access:'stats endpoints that require browser-like headers',
  rights:'Not a documented public API; automated access not permitted without agreement',availabilityTime:'unknown for historical data',usedFor:[],cost:'n/a',
  blocker:'No documented, permitted access. Will not be scraped.',whereInCode:null},
 // ------------------------------------------------------------ stocks
 {id:'alpaca-market-data',domain:'stocks',status:'connected',reliability:'licensed-provider',access:'Existing authorized paper key pair; read-only GETs',
  rights:'Covered by the existing Alpaca account terms',availabilityTime:'bar close time; decisions use completed bars only',usedFor:['daily bars','corporate-action-adjusted closes'],
  cost:'free tier already in use',blocker:null,whereInCode:'analytics/stock_weekly_backtest_v1.py'},
 {id:'sec-edgar-13f',domain:'stocks',status:'connected',reliability:'regulatory',access:'data.sec.gov with a declared User-Agent (repository secret), <= 10 requests/s',
  rights:'US government public data',availabilityTime:'filing acceptance date (filed); holdings are as of the report period, available only from filing',
  usedFor:['delayed-holdings follower research'],cost:'free',blocker:null,whereInCode:'analytics/research/sec13f.py'},
 {id:'sec-edgar-companyfacts',domain:'stocks',status:'connected',reliability:'regulatory',access:'data.sec.gov/api/xbrl/companyfacts/CIK##########.json with a declared User-Agent',
  rights:'US government public data',availabilityTime:"each fact's 'filed' date: a fundamental is usable only on or after the day its filing was accepted",
  usedFor:['point-in-time fundamentals (quality, value) for stock research'],cost:'free',
  blocker:null,whereInCode:'scripts/research-intake-collect.ts (verified: Actions run 43498666563, 10/10 companies, 0 point-in-time leaks; manual/push only, no schedule)'},
 {id:'qmom-holdings',domain:'stocks',status:'connected',reliability:'official',access:'Public fund holdings page; robots.txt crawl-delay 10',
  rights:'Public disclosure',availabilityTime:'retrieval time (no historical archive): forward-only',usedFor:['disclosed-holdings follower (forward)'],cost:'free',blocker:null,whereInCode:'analytics/research/qmom.py'},
 {id:'survivorship-free-constituents',domain:'stocks',status:'proposed',reliability:'licensed-provider',access:'Historical index membership with add/remove dates',
  rights:'Typically a paid licence',availabilityTime:'membership effective dates',usedFor:['removing survivorship bias from every stock backtest'],cost:'paid: needs explicit owner approval',
  blocker:'No free source with verified point-in-time membership identified; purchasing data needs owner approval.',whereInCode:null},
 // ------------------------------------------------------------ literature (both)
 {id:'openalex',domain:'both',status:'connected',reliability:'peer-reviewed',access:'api.openalex.org, no key, <= 10 requests/s',rights:'CC0 metadata',
  availabilityTime:'publication date; literature never enters point-in-time features',usedFor:['hypothesis discovery'],cost:'free',
  blocker:null,whereInCode:'scripts/research-intake-collect.ts (verified: Actions run 43498666563, 5/5 queries; hypothesis-only)'},
 {id:'arxiv',domain:'both',status:'connected',reliability:'secondary',access:'export.arxiv.org, 1 request per 3 s',rights:'Metadata CC0; e-prints not re-served',
  availabilityTime:'submission date; literature never enters point-in-time features',usedFor:['hypothesis discovery'],cost:'free',
  blocker:null,whereInCode:'scripts/research-intake-collect.ts (verified: Actions run 43498666563, 3/3 queries; hypothesis-only)'},
];

/** Consistency rules the register must satisfy (tested): nothing paid is connected without saying so, and every
 * non-connected source states its blocker. */
export function registerProblems(r:SourceEntry[]=SOURCE_REGISTER):string[]{
 const p:string[]=[];const ids=new Set<string>();
 for(const s of r){
  if(ids.has(s.id))p.push('duplicate '+s.id);ids.add(s.id);
  if(s.status!=='connected'&&!s.blocker)p.push(s.id+': non-connected source without a blocker');
  if(s.status==='connected'&&!s.whereInCode)p.push(s.id+': connected source without code');
  if(/paid/i.test(s.cost)&&s.status==='connected'&&!/approved/i.test(s.cost))p.push(s.id+': paid source connected without approval');
  if(!s.availabilityTime)p.push(s.id+': no availability-time rule');
 }
 return p;
}
export const sourceById=(id:string)=>SOURCE_REGISTER.find(s=>s.id===id)??null;
