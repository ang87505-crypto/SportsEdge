/**
 * SEC company facts, point-in-time v2: duration-aware parsing and audits. Pure; no I/O; no collector is enabled here.
 * docs/STOCK_DATA_QUALITY_AUDIT_2026_11_20.md
 *
 * Why v2: the v1 parser (sec-companyfacts.ts, unchanged) drops each fact's `start` date. For flow items (revenue,
 * income, cash flow) a 10-Q reports the 3-month quarter AND the year-to-date figure with the same `end`, and a 10-K
 * reports the 12-month year. v1 `asOf` therefore returns a 3-, 6-, 9- or 12-month value depending on sort order: values
 * that are not comparable across companies or dates. v1 also counts every repeated period (comparative columns,
 * QTD vs YTD) as a "restatement".
 *
 * v2 keeps `start`, classifies each fact as instant / quarter / annual / other, looks up as-of values for ONE kind, and
 * separates true restatements (a later filing changed the value for the same period) from repeated comparatives.
 * Availability is the filing date (`filed`): a value is usable for a decision only on a later day.
 */

export type PeriodKind='instant'|'quarter'|'annual'|'other';
export type PitFactV2={cik:string;tag:string;unit:string;start:string|null;periodEnd:string;kind:PeriodKind;days:number|null;
 value:number;form:string;accession:string;filed:string;frame:string|null};

const FORMS=new Set(['10-K','10-Q','10-K/A','10-Q/A']);
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const days=(a:string,b:string)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86_400_000)+1;

/** Quarter: 80-100 days inclusive; annual: 350-380; no start: instant (balance-sheet items). */
export function periodKind(start:string|null,end:string):{kind:PeriodKind;days:number|null}{
 if(start===null)return {kind:'instant',days:null};
 const n=days(start,end);
 return {kind:n>=80&&n<=100?'quarter':n>=350&&n<=380?'annual':'other',days:n};
}

/** Parse every us-gaap tag listed (or all tags when `tags` is omitted). Malformed rows are dropped and counted. */
export function parseCompanyFactsV2(body:unknown,tags?:readonly string[]):{facts:PitFactV2[];dropped:number}{
 const b=body as {cik?:unknown;facts?:{'us-gaap'?:Record<string,{units?:Record<string,unknown[]>}>}};
 const cik=typeof b?.cik==='number'||typeof b?.cik==='string'?String(b.cik).padStart(10,'0'):null;
 const gaap=b?.facts?.['us-gaap'];
 if(!cik||!/^\d{10}$/.test(cik)||!gaap||typeof gaap!=='object')return {facts:[],dropped:0};
 const facts:PitFactV2[]=[];let dropped=0;
 for(const tag of tags??Object.keys(gaap).sort()){
  const units=gaap[tag]?.units;if(!units)continue;
  for(const [unit,rows] of Object.entries(units)){
   if(!Array.isArray(rows))continue;
   for(const raw of rows){
    const x=raw as {start?:unknown;end?:unknown;val?:unknown;form?:unknown;accn?:unknown;filed?:unknown;frame?:unknown};
    const start=x.start===undefined?null:x.start;
    if(typeof x.end!=='string'||!DAY.test(x.end)||(start!==null&&(typeof start!=='string'||!DAY.test(start)||start>x.end))||
     typeof x.filed!=='string'||!DAY.test(x.filed)||typeof x.val!=='number'||!Number.isFinite(x.val)||
     typeof x.form!=='string'||!FORMS.has(x.form)||typeof x.accn!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(x.accn)||x.filed<x.end){
     dropped++;continue;
    }
    const k=periodKind(start as string|null,x.end);
    facts.push({cik,tag,unit,start:start as string|null,periodEnd:x.end,kind:k.kind,days:k.days,value:x.val,form:x.form,
     accession:x.accn,filed:x.filed,frame:typeof x.frame==='string'?x.frame:null});
   }
  }
 }
 facts.sort((a,b)=>a.tag.localeCompare(b.tag)||a.unit.localeCompare(b.unit)||(a.start??'').localeCompare(b.start??'')||
  a.periodEnd.localeCompare(b.periodEnd)||a.filed.localeCompare(b.filed)||a.accession.localeCompare(b.accession));
 return {facts,dropped};
}

/**
 * The value of `tag` for ONE period kind as it was publicly known strictly before `asOfDay`: among facts filed before
 * that day, the newest period end; for that period, the latest filing (a restatement counts only once filed).
 */
export function asOfKind(facts:PitFactV2[],tag:string,kind:PeriodKind,asOfDay:string,unit='USD'):PitFactV2|null{
 let best:PitFactV2|null=null;
 for(const f of facts){
  if(f.tag!==tag||f.kind!==kind||f.unit!==unit||!(f.filed<asOfDay))continue;
  if(!best||f.periodEnd>best.periodEnd||(f.periodEnd===best.periodEnd&&
   (f.filed>best.filed||(f.filed===best.filed&&f.accession>best.accession))))best=f;
 }
 return best;
}

/** Group by tag+unit+start+end: repeated comparatives (same value) vs true restatements (a later filing changed it). */
export function restatementReport(facts:PitFactV2[]){
 const groups=new Map<string,PitFactV2[]>();
 for(const f of facts){const k=[f.tag,f.unit,f.start??'',f.periodEnd].join('|');groups.set(k,[...(groups.get(k)??[]),f]);}
 let repeated=0,restated=0;const examples:{tag:string;start:string|null;periodEnd:string;first:number;latest:number;restatedOn:string}[]=[];
 for(const g of groups.values()){
  if(g.length<2)continue;
  g.sort((a,b)=>a.filed.localeCompare(b.filed)||a.accession.localeCompare(b.accession));
  if(g.every(f=>f.value===g[0].value)){repeated++;continue;}
  restated++;
  const changed=g.find(f=>f.value!==g[0].value)!;
  if(examples.length<10)examples.push({tag:g[0].tag,start:g[0].start,periodEnd:g[0].periodEnd,first:g[0].value,latest:g.at(-1)!.value,restatedOn:changed.filed});
 }
 return {periods:groups.size,repeatedSameValue:repeated,trueRestatements:restated,examples};
}

/**
 * Ambiguity of a duration-blind lookup (v1 semantics: newest end, then newest filing, ignoring duration): for each
 * cutoff and flow tag, does the duration-blind answer differ in duration from the quarterly answer for that end?
 */
export function durationAmbiguity(facts:PitFactV2[],tags:readonly string[],cutoffs:readonly string[]){
 let checked=0,ambiguous=0,mixedKinds=0;
 for(const tag of tags)for(const day of cutoffs){
  const blind=facts.filter(f=>f.tag===tag&&f.unit==='USD'&&f.kind!=='instant'&&f.filed<day);
  if(!blind.length)continue;
  checked++;
  const end=blind.reduce((m,f)=>f.periodEnd>m?f.periodEnd:m,'');
  const sameEnd=blind.filter(f=>f.periodEnd===end);
  const kinds=new Set(sameEnd.map(f=>f.kind));
  if(kinds.size>1){ambiguous++;}
  if(new Set(sameEnd.map(f=>f.days)).size>1)mixedKinds++;
 }
 return {checked,endsWithSeveralDurations:ambiguous,endsWithSeveralLengths:mixedKinds};
}

/**
 * Identity sanity for a ticker→CIK mapping taken from the SEC's CURRENT company_tickers.json: a CIK whose earliest
 * filing is after the research window start cannot provide point-in-time history for that window (for example a new
 * holding-company registrant after a reorganization). Flag it; never back-fill from another CIK by guesswork.
 */
export function identityCheck(facts:PitFactV2[],windowStart:string,minFacts=100){
 const earliest=facts.reduce((m,f)=>!m||f.filed<m?f.filed:m,'');
 const flags:string[]=[];
 if(!facts.length)flags.push('NO_FACTS');
 else{
  if(earliest>windowStart)flags.push('HISTORY_STARTS_AFTER_WINDOW');
  if(facts.length<minFacts)flags.push('FEW_FACTS');
 }
 return {facts:facts.length,earliestFiled:earliest||null,flags,usable:flags.length===0};
}
