/**
 * Closed-vocabulary conversational repair for free Ask SportsEdge.
 * No external model, no API credits, no private chat storage.
 *
 * Intentionally conservative: only known navigation/intent words are changed.
 * We never fuzzy-correct tickers, player names, numeric values or an unknown
 * business/entity into a financial instruction.
 */
import {normalize} from './understand.ts';

const DIRECT:Readonly<Record<string,string>>=Object.freeze({
 wer:'were',improv:'improve',
 pls:'please',plz:'please',plss:'please',rn:'right now',yday:'yesterday',
 ydayy:'yesterday',ystrday:'yesterday',ystrdy:'yesterday',
 tmrwz:'tomorrow',tonite:'tonight',twonite:'tonight',
 wats:'what is',wat:'what',wht:'what',whr:'where',
 ar:'are',ur:'your',u:'you',r:'are',idk:'i do not know',
 smth:'something',nothin:'nothing',nuthing:'nothing',abt:'about',
 cant:'cannot',coudnt:'could not',wont:'will not',shant:'shall not',
 botz:'bots',botss:'bots',dashbord:'dashboard',dashbaord:'dashboard',
 systm:'system',systmes:'systems',sysytem:'system',settlemnt:'settlement',
 activat:'activate',autopliot:'autopilot',
 preditcions:'predictions',prediciton:'prediction',accuraccy:'accuracy',
 loses:'losses',loosing:'losing',wining:'winning',prfit:'profit',
 mony:'money',statz:'stats',statss:'stats',stoksbot:'stock bot',
 calsi:'kalshi',kalish:'kalshi',kalshiis:'kalshi',
 wheatherz:'weather',wether:'weather',weathr:'weather',
 opportunitites:'opportunities',oppertunities:'opportunities',oppertunity:'opportunity',
 commnads:'commands',comands:'commands',commadns:'commands',
 commnd:'command',controlls:'controls',controlz:'controls',
 retarin:'retrain',retreain:'retrain',retrainn:'retrain',
 calabration:'calibration',calbiration:'calibration',
 nhll:'nhl',nfll:'nfl',baskteball:'basketball',basebal:'baseball',

 kalhsi:'kalshi',kalsi:'kalshi',kalsh:'kalshi',
 alpca:'alpaca',alapca:'alpaca',
 stoks:'stocks',stokcs:'stocks',stcoks:'stocks',stockz:'stocks',
 trdes:'trades',tradse:'trades',tradz:'trades',
 piks:'picks',pikcs:'picks',pikz:'picks',
 propz:'props',rebs:'rebounds',
 todays:'today',todayss:'today',tmrw:'tomorrow',tmr:'tomorrow',
 tommorow:'tomorrow',tomorow:'tomorrow',
 yesterdays:'yesterday',yesturday:'yesterday',yesterdya:'yesterday',
 resutls:'results',resultz:'results',
 accurracy:'accuracy',acuracy:'accuracy',
 preditions:'predictions',predctions:'predictions',predicitons:'predictions',
 forecats:'forecast',forcast:'forecast',
 algoritm:'algorithm',algorythm:'algorithm',
 learnign:'learning',lern:'learn',
 improvment:'improvement',improvments:'improvements',
 beter:'better',bettr:'better',perfomance:'performance',
 automaiton:'automation',wheather:'weather',weater:'weather',
 wheres:'where is',whats:'what is',whens:'when is',
 hows:'how is',howd:'how did',
 dont:'do not',didnt:'did not',
 isnt:'is not',werent:'were not',
 wud:'would',shud:'should',
});
const TERMS=[
 'kalshi','alpaca','stocks','stock','trades','traded','trading',
 'sports','nba','soccer','nfl','nhl','mlb','prizepicks',
 'picks','pick','props','rebounds','assists','lineups','bets','betting',
 'results','result','accuracy','calibration','forecasts','forecast','weather',
 'prediction','predictions','inflation','cpi',
 'learning','learn','algorithm','automation','schedule','scheduled',
 'performance','profit','balance','holdings','positions','portfolio',
 'today','yesterday','tomorrow','tonight',
 'improve','improving','improvements','model','models','training',
 'paper','research','backtest','strategy','strategies','money','credits',
 'record','recorded','future','futures','filled','settled','settlement','scores','graded',
 'account','accounts','future','current','available','availability',
 'sources','refresh','updated','failed','working','status',
 'dashboard','commands','controls','settings','history','receipts','alerts',
 'collector','collectors','settlement','settle','reconcile','reconciliation',
 'activation','activate','deactivate','disabled','enable','enabled',
 'pause','paused','resume','stop','stopped','start','started',
 'autopilot','bots','system','systems','workflow','workflows','jobs',
 'yesterday','last','tomorrow','tonight','right','now','help',
 'opportunity','opportunities','prediction','forecasts',
 'nfl','nhl','mlb','wnba','football','baseball','basketball'
] as const;
const termSet=new Set<string>(TERMS);
function editDistance(a:string,b:string,max:number):number{
 if(Math.abs(a.length-b.length)>max)return max+1;
 const prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){
  const curr=[i];let smallest=i;
  for(let j=1;j<=b.length;j++){
   const v=Math.min(curr[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
   curr[j]=v;smallest=Math.min(smallest,v);
  }
  if(smallest>max)return max+1;
  for(let j=0;j<curr.length;j++)prev[j]=curr[j];
 }
 return prev[b.length];
}
function repair(word:string):string{
 if(!/^[a-z]+$/.test(word))return word;
 if(Object.hasOwn(DIRECT,word))return DIRECT[word];
 if(word.length<6||word.length>16||termSet.has(word))return word;
 // Avoid hallucinating symbols or short proper names; typo correction only
 // if a single known vocabulary word is uniquely within one edit.
 let best:string|null=null;
 for(const term of TERMS){
  if(term[0]!==word[0]||Math.abs(term.length-word.length)>1)continue;
  if(editDistance(word,term,1)===1){
   if(best!==null)return word; // ambiguous => leave it untouched
   best=term;
  }
 }
 return best??word;
}
export function conversationalText(input:string):string{
 if(typeof input!=='string'||input.length>300)return '';
 const n=normalize(input);
 if(!n)return '';
 // Treat content as ordinary text: never execute or query anything here.
 let t=n.split(' ').filter(Boolean).map(repair).join(' ');
 // Common chat contractions/abbreviations; only intent words, never names,
 // ticker symbols, amounts, sport results or numbers.
 t=t.replace(/\br u\b/g,'are you')
  .replace(/\bwanna\b/g,'want to')
  .replace(/\bgonna\b/g,'going to')
  .replace(/\bgimme\b/g,'show me')
  .replace(/\bhow come\b/g,'why')
  .replace(/\bhow many\b/g,'how many')
  .replace(/\bwhy (?:is|are) there no\b/g,'why no');
 // Compact colloquial phrasing with unambiguous, *non-action* intent meaning.
 t=t.replace(/\b(our|the) algo\b/g,'$1 algorithm')
  .replace(/\bhow (can|do|could|should) (we|i) (make (it|this|the (model|system)) )?(get |be )?better( from here)?\b/g,
   'how can we improve from here')
  .replace(/\b(were|was|are|is|did) (our |the |my )?(today|today is|today s) (stock )?trades? good\b/g,
   'how did today stock trades perform')
  .replace(/\b(were|was|are|is|did) (our |the |my )?trades? (today|today is|today s) good\b/g,
   'how did today stock trades perform')
  .replace(/\bwhat (do|can|should) we do (next|from here)\b/g,'how can we improve from here')
  .replace(/\bwhat about (that|those|it)\b/g,'what about that');
 return t;
}
