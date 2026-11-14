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
 'record','recorded','filled','settled','settlement','scores','graded',
 'account','accounts','future','current','available','availability',
 'sources','refresh','updated','failed','working','status'
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
