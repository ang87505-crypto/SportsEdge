/**
 * Understanding for the props assistant: a free, rule-based "conversation" with no AI service.
 * Pure: a message plus the previous turn's context becomes an intent and entities. Phrases score
 * double, keywords single; the highest score wins and ties follow INTENT_ORDER. Names are matched
 * only against players present in the loaded data, so nothing is invented.
 */
import type {Platform,Stat} from '../props/contract.ts';
import {playerKey} from '../props/identity.ts';
import type {AssistantDomain,AssistantTopic} from './domain.ts';
import type {ResearchId} from '../research/stock-summary.ts';

export type Intent='picks'|'why'|'results'|'record'|'player'|'entries'|'lineup'|'status'|'model'|'mistakes'|'future'|'help'|'smalltalk'|'bet'|'unknown';
export type RangeKey='today'|'yesterday'|'week'|'all'|`date:${string}`;
export type AssistantContext={intent?:Intent;player?:string;stat?:Stat;range?:RangeKey;lastPickIds?:number[];
 domain?:AssistantDomain;topic?:AssistantTopic;symbol?:string;strategyId?:ResearchId};
export type Parsed={intent:Intent;player:{name:string}|{ambiguous:string[]}|{unknown:string}|null;stat:Stat|null;side:'more'|'less'|null;
 platform:Platform|null;range:RangeKey|null;followUp:boolean};

export const MIN_INTENT_SCORE=1;
export const NICKNAMES:Record<string,string>={joker:'Nikola Jokic','greek freak':'Giannis Antetokounmpo',sga:'Shai Gilgeous-Alexander',
 ad:'Anthony Davis',kd:'Kevin Durant',lebron:'LeBron James',bron:'LeBron James',king:'LeBron James',chef:'Stephen Curry',steph:'Stephen Curry'};

type Rule={phrases:(string|RegExp)[];keywords:string[];weight?:number};
const INTENT_ORDER:Exclude<Intent,'unknown'>[]=['picks','why','results','record','player','entries','lineup','status','model','mistakes','future','help','smalltalk','bet'];
const RULES:Record<Exclude<Intent,'unknown'>,Rule>={
 picks:{phrases:['who should i take','best pick','best picks','top plays','top picks','what do you like','who do you like','good picks','what are the picks',
  'today is picks','tonight is picks'],keywords:['picks','plays','take','like']},
 why:{phrases:['how come','explain that','what makes you like','why do you like','why that','why is'],keywords:['explain','reason'],weight:2},
 results:{phrases:['how did we do','did my picks hit','how did it go','how did last night','did we win','did they hit','how did the picks',
  'how did the games','how did tonight','how did yesterday','how did the night','picks hit'],
  keywords:['results','result','hit','won','win']},
 record:{phrases:['my record','all time record','am i up','how are we doing','how much','hit rate','are we up'],
  keywords:['record','balance','roi','profit','bankroll']},
 player:{phrases:['what is the line','line on','line for','odds for','odds on'],keywords:['line','odds']},
 entries:{phrases:['my entries','open entries','what is riding','my lineups','show entries'],keywords:['entries','entry','riding','lineups']},
 lineup:{phrases:['give me a lineup','copy lineup','build me an entry','make me a','build a lineup','build me a'],keywords:['lineup']},
 status:{phrases:['is it running','next run','did it collect','is everything working','is it on','is it paused'],
  keywords:['running','paused','status','working','collect','stopped']},
 model:{phrases:['which model','is it learning','new model','what did the model learn','model doing'],
  keywords:['model','learning','challengers','challenger','learn']},
 mistakes:{phrases:['what went wrong','why did we lose','why did the picks miss','mistakes'],keywords:['mistakes','wrong','lose','miss'],weight:3},
 future:{phrases:['what will it do','what is next','what happens next','plans'],keywords:['next','plans','will']},
 help:{phrases:['what can you do','help'],keywords:['help']},
 smalltalk:{phrases:[],keywords:['hi','hello','hey','thanks','thank','cool','nice','ok','okay','great','yo']},
 bet:{phrases:['place a bet','bet on','enter this','submit my entry','place an entry','make a bet','place it',/(^| )put \$\d/],keywords:['bet','wager'],weight:3},
};
// "why" alone is a strong signal; it is scored as a phrase so "why booker" beats the player match.
const WHY_WORD=2;
const STATS:[Stat,string[]][]=[['points',['points','point','pts','pt','scoring','score','scores']],['rebounds',['rebounds','rebound','reb','rebs','boards','board']],
 ['assists',['assists','assist','ast','asts','dimes','dime']]];
const FOLLOW=/^(and|also|what about|how about)\b/;
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

const COMMON=new Set(('a an the and or of to in on for at by is are was it its me my i you your we our us do did does what who when how why which '+
 'this that these those about with be been have has had will would can could should there their them they he she his her over under more less '+
 'tonight today yesterday last night week weeks time all overall season ever days past get give show tell any some up out so just please').split(' '));

export function normalize(message:string):string{
 return message.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
  .replace(/[’`]/g,"'").replace(/\b(how|what|when|who|where)'d\b/g,'$1 did').replace(/\b(\w+)'s\b/g,'$1 is').replace(/'re\b/g,' are')
  .replace(/n't\b/g,' not').replace(/'m\b/g,' am').replace(/[^a-z0-9/$. ]+/g,' ').replace(/(?<!\d)\.|\.(?!\d)/g,' ').replace(/\s+/g,' ').trim();
}

function levenshtein(a:string,b:string):number{
 const d=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){let prev=d[0];d[0]=i;
  for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=t;}}
 return d[b.length];
}
const has=(text:string,p:string|RegExp)=>typeof p==='string'?(' '+text+' ').includes(' '+p+' '):p.test(text);

function vocabulary():Set<string>{
 const v=new Set(COMMON);
 for(const r of Object.values(RULES)){for(const p of r.phrases)if(typeof p==='string')p.split(' ').forEach(w=>v.add(w));r.keywords.forEach(w=>v.add(w));}
 for(const [,ws] of STATS)ws.forEach(w=>v.add(w));
 ['pp','prizepicks','prize','pick6','dk','draftkings','pick','6','why'].forEach(w=>v.add(w));
 return v;
}
const VOCAB=vocabulary();

function matchPlayer(text:string,tokens:string[],known:string[]):Parsed['player']{
 const keys=known.map(name=>({name,parts:playerKey(name).split(' ')}));
 const uniq=(names:string[])=>[...new Set(names)];
 const pick=(names:string[]):Parsed['player']=>{const u=uniq(names);return u.length===1?{name:u[0]}:u.length>1?{ambiguous:u.sort()}:null;};
 for(const [nick,name] of Object.entries(NICKNAMES))if(has(text,nick)&&known.includes(name))return {name};
 const full=keys.filter(k=>has(text,k.parts.join(' ')));
 if(full.length)return pick(full.map(k=>k.name));
 // Single-name matches ignore ordinary question words ("last", "night", "will"), which real names can share.
 const named=tokens.filter(t=>!VOCAB.has(t));
 const last=keys.filter(k=>named.includes(k.parts[k.parts.length-1]));
 if(last.length)return pick(last.map(k=>k.name));
 const first=keys.filter(k=>k.parts.length>1&&named.includes(k.parts[0]));
 return pick(first.map(k=>k.name));
}

/**
 * Misspelled names ("bookr", "jokc"). Only tried when the question is about a player or has no other intent,
 * and a token must share the name's first letter and be within one edit (two for 6+ letters), so everyday
 * words ("games", "money", "whats") never become players.
 */
function fuzzyPlayer(tokens:string[],known:string[]):Parsed['player']{
 const loose=tokens.filter(t=>t.length>=4&&!VOCAB.has(t)&&!/\d/.test(t));
 const near=(t:string,p:string)=>p.length>=4&&t[0]===p[0]&&levenshtein(t,p)<=(t.length>=6?2:1);
 const names=[...new Set(known.filter(name=>loose.some(t=>playerKey(name).split(' ').some(p=>near(t,p)))))];
 return names.length===1?{name:names[0]}:names.length>1?{ambiguous:names.sort()}:null;
}

function statOf(tokens:string[]):Stat|null{
 for(const [stat,words] of STATS)if(tokens.some(t=>words.includes(t)))return stat;
 for(const [stat] of STATS)if(tokens.some(t=>t.length>=5&&!VOCAB.has(t)&&levenshtein(t,stat)<=2))return stat;
 return null;
}

/** New Mexico calendar date for an instant. */
const mtDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
function rangeOf(text:string,nowIso:string):RangeKey|null{
 const today=mtDate(nowIso);const year=Number(today.slice(0,4));
 const dated=(m:number,d:number):RangeKey|null=>{
  if(m<1||m>12||d<1||d>31)return null;
  let y=year;const s=(yy:number)=>`${yy}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  if(s(y)>today)y--;
  return `date:${s(y)}`;
 };
 const named=new RegExp('\\b('+MONTHS.join('|')+')[a-z]*\\.? (\\d{1,2})\\b').exec(text);
 if(named)return dated(MONTHS.indexOf(named[1])+1,Number(named[2]));
 const slash=/\b(\d{1,2})\/(\d{1,2})\b/.exec(text);
 if(slash)return dated(Number(slash[1]),Number(slash[2]));
 if(has(text,'last night')||has(text,'yesterday'))return 'yesterday';
 if(has(text,'tonight')||has(text,'today'))return 'today';
 if(has(text,'this week')||has(text,'last 7 days')||has(text,'past week')||has(text,'week'))return 'week';
 if(has(text,'all time')||has(text,'overall')||has(text,'season')||has(text,'ever'))return 'all';
 return null;
}

function platformOf(text:string):Platform|null{
 if(['pick6','pick 6','dk','draftkings'].some(p=>has(text,p)))return 'pick6';
 if(['prizepicks','prize picks','pp'].some(p=>has(text,p)))return 'prizepicks';
 return null;
}

export function understand(message:string,context:AssistantContext|null,knownPlayers:string[],nowIso:string):Parsed{
 if(!message.trim())return {intent:'help',player:null,stat:null,side:null,platform:null,range:null,followUp:false};
 const text=normalize(message);
 const tokens=text.split(' ').filter(Boolean);
 let player=text?matchPlayer(text,tokens,knownPlayers):null;
 const stat=statOf(tokens);
 const side=tokens.some(t=>t==='over'||t==='more')?'more':tokens.some(t=>t==='under'||t==='less')?'less':null;
 const platform=platformOf(text);
 const range=rangeOf(text,nowIso);

 const scores=new Map<Intent,number>();
 for(const intent of INTENT_ORDER){
  const r=RULES[intent];let s=0;
  for(const p of r.phrases)if(has(text,p))s+=2*(r.weight??1);
  for(const k of r.keywords)if(tokens.includes(k))s+=1;
  if(intent==='why'&&tokens.includes('why'))s+=WHY_WORD;
  if(intent==='player'&&player)s+=2;
  scores.set(intent,s);
 }
 let intent:Intent='unknown';let best=0;
 for(const i of INTENT_ORDER){const s=scores.get(i)!;if(s>best){best=s;intent=i;}}
 if(best<MIN_INTENT_SCORE)intent='unknown';
 if(!player&&(intent==='unknown'||intent==='why'||intent==='player')){
  player=fuzzyPlayer(tokens,knownPlayers);
  if(player&&intent==='unknown')intent='player';
 }

 // A follow-up needs a link to the last answer: a lead-in ("and", "what about"), "why", or something new to filter by.
 // Words with neither ("asdf", emoji, markup) get the help reply instead of a repeat of the last answer.
 const entity=!!(player||stat||side||platform||range);
 const followUp=!!context?.intent&&(FOLLOW.test(text)||(tokens.length<=4&&(entity||intent==='why')))&&
  (intent==='unknown'||intent==='why'||intent==='player'||FOLLOW.test(text));
 let out:Parsed={intent,player,stat,side,platform,range,followUp:false};
 if(followUp){
  out.followUp=true;
  if(intent==='unknown')out.intent=context!.intent!;
  if(!out.player&&context!.player&&out.intent===context!.intent)out.player={name:context!.player};
  if(!out.range&&context!.range&&out.intent===context!.intent)out.range=context!.range;
 }
 // A name the data does not know is reported back as typed, only for a line question.
 if(out.intent==='player'&&!out.player){
  const m=/(?:line on|line for|odds for|odds on|about)\s+(.+)$/.exec(text);
  const name=m?m[1].split(' ').filter(t=>!VOCAB.has(t)&&!/^\d/.test(t)).join(' '):'';
  if(name)out={...out,player:{unknown:name}};
 }
 return out;
}
