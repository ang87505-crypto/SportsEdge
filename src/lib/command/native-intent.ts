/**
 * SportsEdge's own tiny, CPU-only intent model.
 *
 * The "training set" is a versioned collection of representative questions.
 * It uses a weighted lexical nearest-neighbour classifier, not a hosted LLM,
 * a generic pretrained model, external weights, provider API calls or tokens.
 * The model only selects from already-authorized READ-ONLY tool schemas.
 *
 * Low similarity / ambiguous requests ABSTAIN, falling through to the
 * existing domain-aware SportsEdge assistant rather than inventing an answer.
 */
import type {ToolCall} from './session.ts';
export type NativeDecision={call:ToolCall;filter?:'hits'|'misses';example:string;confidence:number};
type Example={q:string;tool:string;input:Record<string,unknown>;filter?:'hits'|'misses';topic:'sports'|'stocks'|'research'|'ops'|'briefing'};
const e=(topic:Example['topic'],tool:string,input:Record<string,unknown>,qs:string,filter?:Example['filter']):Example[]=>
 qs.split(';').map(q=>({topic,tool,input,q:q.trim(),...(filter?{filter}:{})}));
/** A deliberately narrow training catalog; extending requires new negative tests. */
export const NATIVE_EXAMPLES:readonly Example[]=[
 ...e('briefing','todays_activity',{},'give me an update on the entire site;catch me up on sportsedge;what needs my approval right now;what is happening across the platform;give me the command center briefing'),
 ...e('sports','sports_results',{period:'today'},'how many picks hit today;show today recorded pick outcomes;what is our hit rate today;show the nba selection results tonight;what were the props results today'),
 ...e('sports','sports_results',{period:'yesterday'},'how many picks hit yesterday;show yesterday recorded pick outcomes;what was our pick accuracy last night;how many nba picks were graded yesterday;what were prizepicks results yesterday'),
 ...e('sports','sports_results',{period:'last_7_days'},'show recorded props wins this week;how accurate were our sports picks over the past week;what were nba pick results in the last seven days;how many prizepicks predictions hit this week'),
 ...e('sports','sports_results',{period:'prior_7_days'},'what was our props record the week before;show previous week nba pick results;how accurate were the prizepicks picks last week'),
 ...e('sports','sports_results',{period:'yesterday'},'which picks missed last night;show yesterday losing player props;list the wrong nba picks yesterday','misses'),
 ...e('sports','sports_results',{period:'yesterday'},'which picks were correct yesterday;show yesterday winning player props','hits'),
 ...e('sports','upcoming_picks',{},'show upcoming player props;which nba picks are not locked yet;what are the next saved props predictions;list tonight upcoming picks;which scored nba picks are still open'),
 ...e('sports','virtual_bankroll',{},'what is our virtual bankroll;how much paper money do we have;show recorded prizepicks virtual profit;what is the paper account roi;how many virtual entries are open'),
 ...e('research','learning_lab',{},'show the learning lab;which nba model is active;show sports model challengers;how many forward samples have we graded;which experimental model layers helped'),
 ...e('research','research_strategies',{},'show the stock strategy research;which stock strategies qualified;are our stock research strategies profitable;how did momentum strategy backtests perform'),
 ...e('research','research_experiments',{status:'rejected'},'which experimental ideas were rejected;show rejected learning engine experiments;why were research ideas rejected'),
 ...e('research','research_experiments',{status:'active'},'which learning engine research experiments are active;show active research intake experiments'),
 ...e('ops','automation_health',{},'which background jobs failed;show the job health monitor;are the scheduled github actions failing;what automation alerts need investigation;show automation workflow receipts'),
 ...e('stocks','stock_status',{},'show stock autopilot status;what is the stock paper bot gate;check stock paper order readiness;show my signed in stock paper status')
];
export const NATIVE_CATALOG_VERSION='sportsedge-local-intents-v1';
const MAP:Record<string,string>={
 'picks':'pick','predictions':'prediction','props':'prop','results':'result','outcomes':'result',
 'wins':'win','winning':'win','hits':'hit','graded':'grade','losing':'loss','losses':'loss',
 'jobs':'job','workflows':'job','alerts':'alert','failed':'fail','failing':'fail',
 'trades':'trade','trading':'trade','strategies':'strategy','experiments':'experiment',
 'backtests':'backtest','active':'active','upcoming':'upcoming','tonights':'tonight',
 'today\'s':'today','yesterdays':'yesterday','prices':'price','lines':'line'
};
const IGNORE=new Set(['the','a','an','do','did','does','can','could','please','our','my','me','us','we','you','show','tell','what','which','how','was','were','is','are','at','in','on','for','of','about','with','to','and','it','any','many','have','has','had','will','would','from','all','give']);
function tokens(input:string):Set<string>{
 const t=input.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9 ]+/g,' ').split(/\s+/)
  .map(x=>MAP[x]??x).filter(x=>x.length>=2&&!IGNORE.has(x));
 return new Set(t);
}
const examples=NATIVE_EXAMPLES.map(x=>({...x,tokens:tokens(x.q)}));
const corpus=new Map<string,number>();
for(const x of examples)for(const t of x.tokens)corpus.set(t,(corpus.get(t)??0)+1);
function idf(t:string):number{return Math.log(1+(examples.length+1)/(1+(corpus.get(t)??0)))}
function similarity(a:Set<string>,b:Set<string>){
 let intersection=0,union=0,common=0;
 const full=new Set([...a,...b]);
 for(const t of full){
  const w=idf(t);union+=w;
  if(a.has(t)&&b.has(t)){intersection+=w;common++;}
 }
 return {score:union?intersection/union:0,common};
}
const SAME=(a:Example,b:Example)=>a.tool===b.tool&&a.filter===b.filter&&JSON.stringify(a.input)===JSON.stringify(b.input);
const forbidden=/\b(buy|sell|place|submit|execute|trade|bet|wager|pause|resume|stop|start|turn on|turn off|activate|disable|enable|promote|deploy|merge|retrain|backfill|scrape|login|sign in|withdraw|deposit)\b/;
const unsupported=/\b(kalshi|noaa|nws|cpi|bls|weather|inflation|prediction market|forecast market)\b/;
const stock=/\b(stocks?|alpaca|portfolio|broker|shares?|autopilot|stock bot|equity)\b/;
const sports=/\b(nba|basketball|prizepicks|pick6|sports?|dfs|player props?)\b/;
/**
 * Classifier has NO authority to execute anything, promote a model, write to
 * the ledger or reveal private data. Even after selection the existing
 * callTool() gate validates schemas AND requires ownerAccess for stock_status.
 */
export function nativeIntent(message:string):NativeDecision|null{
 if(typeof message!=='string'||message.length>500)return null;
 const text=message.toLowerCase().replace(/[’']/g,'');
 if(forbidden.test(text)||unsupported.test(text)||(stock.test(text)&&sports.test(text)))return null;
 const query=tokens(text);
 if(query.size<2)return null;
 const candidates=examples.map(x=>({...x,match:similarity(query,x.tokens)}))
  .filter(x=>!((stock.test(text))&&x.topic!=='stocks'&&x.topic!=='research'))
  .filter(x=>!(!stock.test(text)&&x.topic==='stocks'))
  .filter(x=>!((sports.test(text))&&(x.topic==='stocks'||x.tool==='research_strategies')))
  .sort((a,b)=>b.match.score-a.match.score);
 const first=candidates[0];
 if(!first)return null;
 if(first.match.common<2||first.match.score<0.72)return null;
 const competitor=candidates.find(x=>!SAME(x,first));
 // Ambiguous among distinct outputs means the model explicitly abstains.
 if(competitor&&first.match.score-competitor.match.score<0.09)return null;
 return {call:{tool:first.tool,input:{...first.input}},...(first.filter?{filter:first.filter}:{}),
  example:first.q,confidence:Math.round(first.match.score*1000)/1000};
}
