/** A deterministic, read-only conversation over the page's saved props records. No network or model API. */
import type {Platform,Stat} from './contract.ts';
import {PLATFORM_LABEL} from './contract.ts';
import {playerKey} from './identity.ts';
import {mtShort} from './summary.ts';
import {nextPlannedRuns} from './schedule.ts';

export type ChatLine={
 id:number;player:string;stat:Stat;line:number;game:string;lockAt:string;ingestedAt:string;
 side:'more'|'less'|null;recorded:boolean;probability:number|null;mean:number|null;modelVersion:string|null;
 result:{outcome:string;actual:number|null}|null;correct:boolean|null;
 books:{probability:number|null;count:number;gap:number|null;flags:string[]}|null;
};
export type ChatEntry={id:number;lockAt:string;legIds:number[];profitCents:number|null;settled:boolean};
export type ChatPlatform={lines:ChatLine[];entries:ChatEntry[];account:string|null;initialCents:number|null};
export type ChatData={
 asOf:string;issue:'not_configured'|'unavailable'|null;platforms:Record<Platform,ChatPlatform>;
 scheduleEnabled:boolean;control:{state:string;reason:string}|null;status:string|null;
 model:{active:string;learningEnabled:boolean;autoSwitchEnabled:boolean;challengers:{version:string;state:string;gradedLines:number}[]}|null;
};
type Intent='picks'|'results'|'record'|'balance'|'schedule'|'status'|'why'|'books'|'model'|'lineup'|'controls'|'help';
type Period='today'|'yesterday'|'tomorrow'|'week'|'loaded';
export type ChatContext={platform:Platform;intent?:Intent;period?:Period;player?:string;stat?:Stat;lineId?:number;clarifying?:boolean};
export type ChatReply={text:string;asOf:string;suggestions:string[];context:ChatContext;copyText?:string;link?:{href:string;label:string}};
const SUGGESTIONS=['Who should I take tonight?','How did we do last night?','Is automation running?','When is the next collection?'];
const normalize=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/['’]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
const money=(n:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const percent=(p:number)=>`${Math.round(p*100)}%`;
const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'});
export function mountainDay(iso:string):string{
 const parts=dateFormat.formatToParts(new Date(iso));
 return ['year','month','day'].map(t=>parts.find(p=>p.type===t)!.value).join('-');
}
const addDays=(day:string,n:number)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
function inPeriod(iso:string,period:Period,now:string){
 const day=mountainDay(iso),today=mountainDay(now);
 if(period==='loaded')return true;
 if(period==='week')return day>=addDays(today,-6)&&day<=today;
 return day===addDays(today,period==='yesterday'?-1:period==='tomorrow'?1:0);
}
const periodLabel=(p:Period)=>({today:'today',yesterday:'yesterday',tomorrow:'tomorrow',week:'the last 7 Mountain-time dates',loaded:'the loaded records'}[p]);
const label=(l:ChatLine)=>`${l.player} ${l.side==='more'?'More':'Less'} ${l.line} ${l.stat}`;
const uncertainty=(l:ChatLine)=>l.probability===null?'No probability is available.':`${percent(l.probability)} is a model estimate. If calibrated, that still means about ${Math.round((1-l.probability)*100)} losses per 100 similar picks.`;

function intentOf(s:string):Intent|undefined{
 if(/\b(pause|resume|stop|retrain|roll back|rollback|approve switch|turn learning|turn auto)\b/.test(s)&&!/^is |^why |^when |^how /.test(s))return 'controls';
 if(/\b(copy|lineup|entry to copy)\b/.test(s))return 'lineup';
 if(/\b(balance|bankroll|profit|money|up this week|down this week)\b/.test(s))return 'balance';
 if(/\b(record|accuracy|hit rate|win rate|how often)\b/.test(s))return 'record';
 if(/\b(results?|last night|howd .+ (do|go)|how did .+ (do|go|perform)|did .+ (hit|win)|picks hit|bets hit|wins|losses)\b/.test(s))return 'results';
 if(/\b(schedule|when|next (run|collection|grading)|what time)\b/.test(s))return 'schedule';
 if(/\b(status|running|automation|paused|stopped)\b/.test(s))return 'status';
 if(/\b(books?|sportsbooks?|pros|vegas|odds|fanduel|betmgm|caesars)\b/.test(s))return 'books';
 if(/\b(model|learn|learning|calibrat|calibration|confidence|how .+ works?|how does .+ work)\b/.test(s))return 'model';
 if(/\b(why|explain|reason|because)\b/.test(s))return 'why';
 if(/\b(picks?|bets?|take|best|recommend|tonight|tonights)\b/.test(s))return 'picks';
 if(/\b(help|hello|hi|hey|thanks|thank you|what can you)\b/.test(s))return 'help';
}
function periodOf(s:string):Period|undefined{
 if(/\b(yesterday|last night)\b/.test(s))return 'yesterday';
 if(/\b(tomorrow)\b/.test(s))return 'tomorrow';
 if(/\b(this week|last 7 days|past 7 days)\b/.test(s))return 'week';
 if(/\b(today|tonight)\b/.test(s))return 'today';
 if(/\b(overall|all time|alltime|ever|loaded|total)\b/.test(s))return 'loaded';
}
const STOP=new Set(('who should i we you me my our your take picks pick bet bets nba basketball best recommend top two three tonights todays tonight today tomorrow yesterday last night now how howd did do does is are was were it its the a an and or what about why explain reason because more less points point pts rebounds rebound reb assists assist ast for on at of in to with all list full show see get find give tell please can could would want results result hit win wins lose loss losses record accuracy rate balance bankroll profit money week this past days odds books book sportsbooks sportsbook pros think say from that one those them he him they his her their than over under hello hi hey thanks thank help need overall time ever total lineup copy entry prizepicks prize picks pick6 pick 6 draftkings dk pp').split(' '));
const ALIASES:Record<string,string>={joker:'nikola jokic',steph:'stephen curry',giannis:'giannis antetokounmpo','greek freak':'giannis antetokounmpo',ant:'anthony edwards'};
function distance(a:string,b:string){
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const row=[i];for(let j=1;j<=b.length;j++)row.push(Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)));prev=row;}
 return prev[b.length];
}
function playerOf(s:string,names:string[]):{player?:string;choices?:string[];unknown?:boolean}{
 const full=names.filter(n=>(' '+s+' ').includes(' '+normalize(n)+' '));
 if(full.length===1)return {player:full[0]};
 if(full.length>1)return {choices:full};
 for(const [alias,key] of Object.entries(ALIASES))if((' '+s+' ').includes(' '+alias+' ')){
  const matches=names.filter(n=>playerKey(n)===key);if(matches.length===1)return {player:matches[0]};
 }
 const tokens=s.split(' ').filter(t=>t.length>=3&&!STOP.has(t)&&!/^\d+$/.test(t));
 if(!tokens.length)return {};
 const scored=names.map(name=>{
  const words=normalize(name).split(' ');
  const score=tokens.reduce((sum,t)=>sum+(words.includes(t)?4:words.some(w=>t.length>=4&&w.length>=4&&distance(w,t)<=(t.length>=8?2:1))?1:0),0);
  return {name,score};
 });
 const best=Math.max(0,...scored.map(x=>x.score));
 const matches=scored.filter(x=>x.score===best&&best>0).map(x=>x.name);
 return matches.length===1?{player:matches[0]}:matches.length?{choices:matches.slice(0,5)}:{unknown:true};
}

/** Every answer is computed from this snapshot; conversational text can never dispatch an action. */
export function answerProps(message:string,previous:ChatContext,data:ChatData,nowIso=data.asOf):ChatReply{
 const s=normalize(message.slice(0,300));
 const explicit=intentOf(s.replace(/\bdraftkings pick\s?6\b/g,''));
 const platform:Platform=/\b(pick\s?6)\b/.test(s)?'pick6':/\b(prize\s?picks|pp)\b/.test(s)?'prizepicks':previous.platform;
 const stat:Stat|undefined=/\b(rebounds?|reb)\b/.test(s)?'rebounds':/\b(assists?|ast)\b/.test(s)?'assists':/\b(points?|pts)\b/.test(s)?'points':undefined;
 const period=periodOf(s);
 const followup=!explicit||explicit==='why'||explicit==='books';
 const context:ChatContext={platform,intent:explicit??previous.intent,period:period??(followup?previous.period:undefined),stat:stat??(followup?previous.stat:undefined)};
 const reply=(text:string,suggestions=SUGGESTIONS,extra:Pick<ChatReply,'copyText'|'link'>={}):ChatReply=>({text,asOf:data.asOf,suggestions,context,...extra});
 const intent=context.intent;
 if(!s||s.length<2)return reply('Ask me about picks, results, your record, sportsbook odds or the schedule.');
 if(/\b(place|submit|enter|wager|deposit|withdraw)\b/.test(s))return reply('I can show or copy a saved paper lineup for you to enter manually. This bot cannot submit entries or move money.',['Copy lineup','Who should I take tonight?']);
 if(intent==='help')return reply('I can read your saved picks, explain the model, compare sportsbook signals, show results and copy a recorded lineup. Try ordinary wording or /picks, /results, /record, /balance, /status, /schedule. I use rules and your loaded data; no paid AI service is needed.');
 if(intent==='controls')return data.issue==='not_configured'?reply('The props ledger is not connected, so controls are not available on this deployment. This conversation has not changed anything.'):reply('Use Controls below for Pause, Resume, Stop or learning changes. Owner sign-in and the existing confirmation apply there. This conversation has not changed anything.', ['Is automation running?','How does the model learn?'],{link:{href:'#props-owner-controls',label:'Open controls'}});
 if(intent==='schedule'){
  const runs=nextPlannedRuns(nowIso,6),collect=runs.find(r=>r.kind==='collect'),settle=runs.find(r=>r.kind==='settle');
  const state=data.control?.state;
  const condition=!data.scheduleEnabled?'The daily schedule is off.':state==='PAUSED'||state==='STOPPED'?`Picking is ${state.toLowerCase()}; collection and settlement are blocked until you resume.`:state==='RUNNING'?'These are planned slots; GitHub may start late.':'The current control is unknown, so I cannot verify that a slot will run.';
  return reply(`Next planned collection: ${mtShort(collect?.at)}. Next planned grading: ${mtShort(settle?.at)}. ${condition}`,['Is automation running?','Who should I take tonight?']);
 }
 if(data.issue)return reply(data.issue==='not_configured'?'The props ledger is not connected on this deployment. I cannot see picks, results, a balance or sportsbook odds yet.':'The props ledger did not respond. Refresh status to try again; I have not substituted sample picks or a zero balance.',['When is the next collection?','Help']);
 if(intent==='status')return reply(`${data.status??'Automation status is unavailable.'}${data.control?` Control: ${data.control.state.toLowerCase()}. Reason: ${data.control.reason}`:''} Status was read ${mtShort(data.asOf)}.`,['When is the next collection?','Who should I take tonight?']);
 if(intent==='model'){
  const m=data.model;
  return reply(!m?'The stats model is being used. The learning layer is not set up on this deployment yet. Its estimates can be wrong; a higher predicted probability does not guarantee a win.':`Active model: ${m.active}. Weekly learning is ${m.learningEnabled?'on':'off'} and automatic switching is ${m.autoSwitchEnabled?'on':'off'}. A challenger must pass the registered forward test before taking over: at least 500 graded lines across 14 game nights and 50 games, plus probability-quality checks. ${m.challengers.length?m.challengers.map(c=>`${c.version}: ${c.state}, ${c.gradedLines} graded lines`).join('; ')+'.':'No challengers are recorded yet.'} Retraining does not guarantee improvement.`,['Why that one?','What do the sportsbooks think?']);
 }
 const view=data.platforms[platform];
 const names=[...new Set(view.lines.map(l=>l.player))];
 const found=playerOf(s,names);
 if(found.choices){context.clarifying=true;return reply(`Which player do you mean: ${found.choices.join(' or ')}?`,found.choices);}
 if(found.player){context.player=found.player;if(found.player!==previous.player&&!stat)context.stat=undefined;}
 else if(followup&&!found.unknown)context.player=previous.player;
 if(/\bfull list\b/.test(s)){context.player=undefined;context.stat=stat;}
 // Unsupported wording must never accidentally repeat the previous player's pick.
 if(!explicit&&!found.player&&!stat&&!period&&!/\b(pick\s?6|prize\s?picks|pp|dk|draftkings|that one|full list)\b/.test(s))return reply('I did not match that to a props question. I can help with saved picks, results, odds, record, status and schedule. Try one of these questions.');
 if(found.unknown&&['picks','why','books',undefined].includes(intent)&&!/\b(full list)\b/.test(s))return reply('I could not match a player in the loaded records. Use their full name, or ask for tonight’s picks.',['Who should I take tonight?','Help']);
 context.intent??=found.player?'why':'picks';
 const kind=context.intent;
 if(/\b(last|past) \d+ days\b/.test(s)&&!/\b(last|past) 7 days\b/.test(s)||/\b(last month|last year)\b/.test(s)||/\b\d{4} \d{2} \d{2}\b/.test(s))return reply('I can filter today, yesterday, tomorrow, the last 7 days or the loaded 14-day pick window. I do not have a complete ledger for that requested date range.',['Results yesterday','Record this week','What is my record?']);
 context.period??=kind==='results'?'yesterday':kind==='picks'||kind==='lineup'?'today':'loaded';
 const p=context.period;
 const relevant=view.lines.filter(l=>(!context.player||l.player===context.player)&&(!context.stat||l.stat===context.stat)&&inPeriod(l.lockAt,p,nowIso));
 const scope=`${PLATFORM_LABEL[platform]}, ${periodLabel(p)}${context.player?`, ${context.player}`:''}${context.stat?`, ${context.stat}`:''}`;
 const recorded=relevant.filter(l=>l.recorded);
 const fresh=Date.parse(nowIso)-Date.parse(data.asOf)<=5*60_000;
 const upcoming=recorded.filter(l=>Date.parse(l.lockAt)>Date.parse(nowIso)&&!l.result&&l.side&&l.probability!==null)
  .sort((a,b)=>b.probability!-a.probability!||b.ingestedAt.localeCompare(a.ingestedAt));
 const unique=upcoming.filter((l,i,all)=>all.findIndex(x=>x.player===l.player&&x.stat===l.stat&&x.game===l.game&&x.lockAt===l.lockAt)===i);
 if(kind==='picks'){
  if(!fresh)return reply('This page’s data is more than 5 minutes old. Press Refresh status before asking for upcoming picks.',['Is automation running?']);
  if(!unique.length)return reply(`I have no recorded, unstarted picks for ${scope}. I will not invent one. New picks appear only after a collection finds qualifying lines.`,['When is the next collection?','Is automation running?']);
  const picks=unique.slice(0,/\b(all|full list)\b/.test(s)?8:3),first=picks[0];
  context.player=first.player;context.stat=first.stat;context.lineId=first.id;
  return reply(`For ${scope}:\n${picks.map(l=>`${label(l)} — ${percent(l.probability!)} estimate; locks ${mtShort(l.lockAt)}. Saved ${mtShort(l.ingestedAt)}.`).join('\n')}\n${uncertainty(first)} These are saved lines, not a live offer; check the platform before entering anything.`,['Why that one?','What do the sportsbooks think?','Copy lineup']);
 }
 if(kind==='results'||kind==='record'){
  const graded=recorded.filter(l=>l.correct!==null),won=graded.filter(l=>l.correct).length;
  const pending=recorded.filter(l=>!l.result).length,voids=recorded.filter(l=>l.result&&l.correct===null).length;
  if(!recorded.length)return reply(`There are no recorded picks for ${scope} in the loaded 14-day window. That does not establish an all-time record.`);
  let text=`For ${scope}: ${won}–${graded.length-won} on graded individual picks${graded.length?` (${percent(won/graded.length)} hit rate)`:''}; ${pending} pending, ${voids} tied or void. These counts cover loaded picks from the last 14 days, not an all-time record.`;
  if(kind==='results')text+='\n'+recorded.filter(l=>l.result).slice(0,4).map(l=>`${label(l)}: ${l.correct===null?l.result!.outcome:l.correct?'hit':'missed'}${l.result!.actual===null?'':` (actual ${l.result!.actual})`}.`).join('\n');
  return reply(text,['What is my balance?','Who should I take tonight?']);
 }
 if(kind==='balance'){
  if(context.player||context.stat)return reply('Profit belongs to whole entries, so I cannot assign it to one player or stat. Ask “What is my balance?” for the loaded entry ledger.',['What is my balance?']);
  if(platform==='pick6')return reply('A Pick6 balance or profit is unknown here because payouts depend on other entrants. I can report individual pick results without inventing a payout.',['What is my record on Pick6?']);
  if(view.initialCents===null)return reply('There is no PrizePicks virtual account in the loaded ledger, so its balance is unknown.');
  const entries=view.entries.filter(e=>inPeriod(e.lockAt,p,nowIso)),known=entries.filter(e=>e.settled&&e.profitCents!==null);
  const net=known.reduce((a,e)=>a+e.profitCents!,0),unknown=entries.filter(e=>e.settled&&e.profitCents===null).length;
  const allKnown=view.entries.filter(e=>e.settled&&e.profitCents!==null).reduce((a,e)=>a+e.profitCents!,0);
  return reply(`For ${scope}, known virtual entry profit is ${money(net)} from ${known.length} settled entries. ${unknown?`${unknown} settled payout(s) are unknown, so a complete balance cannot be calculated.`:`Displayed virtual balance: ${money(view.initialCents+allKnown)} (starting ${money(view.initialCents)} plus known profit in the loaded entry ledger).`} There are ${entries.filter(e=>!e.settled).length} open entries in this period. Account: ${view.account}. The loader includes up to 500 entries; this is not a verified lifetime balance.`,['What is my record?','How did we do last night?']);
 }
 if(kind==='lineup'){
  if(!fresh)return reply('Refresh status before copying a lineup; the loaded data is more than 5 minutes old.');
  const entry=view.entries.find(e=>!e.settled&&Date.parse(e.lockAt)>Date.parse(nowIso)&&inPeriod(e.lockAt,p,nowIso)&&e.legIds.length===2&&e.legIds.every(id=>upcoming.some(l=>l.id===id)));
  if(!entry)return reply(`There is no complete, unlocked recorded two-pick entry for ${scope}. I cannot make a lineup out of incomplete or started entries.`,['Who should I take tonight?','When is the next collection?']);
  const legs=entry.legIds.map(id=>upcoming.find(l=>l.id===id)!);
  if(legs[0].player===legs[1].player||legs[0].game===legs[1].game)return reply('That saved entry does not have different players and games, so I cannot offer it as a lineup.');
  const copyText=`${PLATFORM_LABEL[platform]} · saved paper entry #${entry.id}\n${legs.map(l=>`${label(l)} · ${l.game} · locks ${mtShort(l.lockAt)}`).join('\n')}`;
  return reply(`${copyText}\n${uncertainty(legs[0])} The two leg probabilities are not a verified joint win probability. Copying only copies text. Check current lines and enter manually on the platform.`,['Who should I take tonight?'],{copyText});
 }
 if(kind==='why'||kind==='books'){
  const line=relevant.find(l=>l.id===previous.lineId)??[...relevant].sort((a,b)=>b.ingestedAt.localeCompare(a.ingestedAt)).find(l=>l.recorded)??relevant[0];
  if(!line)return reply(`I have no saved line for ${scope}.`,['Who should I take tonight?']);
  if(!context.player&&relevant.some(l=>l.player!==line.player))return reply('Which player should I explain? Use a name or ask for tonight’s picks first.',[...new Set(relevant.map(l=>l.player))].slice(0,4));
  context.player=line.player;context.stat=line.stat;context.lineId=line.id;
  const book=line.books;
  const bookText=book?.probability!=null?`At this same line, ${book.count} sportsbook(s) averaged ${percent(book.probability)} More after removing the margin.`:book?.gap!=null?`No same-line sportsbook probability is available. The nearest sportsbook line was ${Math.abs(book.gap)} ${line.stat} ${book.gap>=0?'higher':'lower'}.`:'No same-line sportsbook odds were saved. I cannot say the pros agree.';
  const heading=line.recorded?label(line):`${line.player}, ${line.line} ${line.stat}: not a recorded pick`;
  return reply(`${heading}. ${kind==='why'&&line.mean!==null?`The stats model expected ${line.mean.toFixed(1)} ${line.stat}. `:''}${bookText}${book?.flags.length?` Flags: ${book.flags.map(f=>f.replaceAll('_',' ')).join(', ')}.`:''} ${line.recorded?uncertainty(line):'No selection is implied.'} Saved ${mtShort(line.ingestedAt)}${Date.parse(line.lockAt)<=Date.parse(nowIso)?'; the game has already locked':''}.`,['What about rebounds?','And Pick6?','Who should I take tonight?']);
 }
 return reply('I can answer questions about your saved props data. Try one of these.');
}
