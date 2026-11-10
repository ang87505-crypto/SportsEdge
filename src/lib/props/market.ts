/**
 * What professional sportsbooks are pricing for a DFS line. Pure.
 * Unknown stays unknown: a line no sportsbook prices for that exact player gets nulls, never a guess.
 */
import type {Stat} from './contract.ts';
import type {BookQuote} from './normalize.ts';
import {playerKey} from './identity.ts';

/** Platform line this far (or more) from the nearest sportsbook line counts as lagging. */
export const LAGGING_LINE_GAP=1.0;
/** Books must lean at least this far to the other side to count as disagreeing with the model. */
export const PROS_DISAGREE_MIN=0.55;

export type MarketFlag='lagging_line'|'pros_disagree';
export type MarketView={booksAtSameLine:number;pMoreBooks:number|null;nearestBookLine:number|null;lineGap:number|null;flags:MarketFlag[]};

const decimal=(american:number)=>american>0?1+american/100:1+100/-american;

/** Margin-free probability of Over from one book's two-way American prices. */
export function noVigMore(overAmerican:number,underAmerican:number):number{
 const o=1/decimal(overAmerican),u=1/decimal(underAmerican);
 return o/(o+u);
}

export function marketView(obs:{providerEventId:string;playerName:string;stat:Stat;line:number},
 quotes:BookQuote[],modelSide:'more'|'less'|null):MarketView{
 const key=playerKey(obs.playerName);
 const mine=quotes.filter(q=>q.providerEventId===obs.providerEventId&&q.stat===obs.stat&&playerKey(q.playerName)===key);
 if(!mine.length)return {booksAtSameLine:0,pMoreBooks:null,nearestBookLine:null,lineGap:null,flags:[]};
 const same=mine.filter(q=>q.line===obs.line);
 const pMoreBooks=same.length?same.reduce((a,q)=>a+noVigMore(q.overPrice,q.underPrice),0)/same.length:null;
 // Nearest posted line; ties go to the line closest to the books' median line.
 const lines=mine.map(q=>q.line).sort((a,b)=>a-b);
 const median=lines.length%2?lines[(lines.length-1)/2]:(lines[lines.length/2-1]+lines[lines.length/2])/2;
 const nearest=[...lines].sort((a,b)=>Math.abs(a-obs.line)-Math.abs(b-obs.line)||Math.abs(a-median)-Math.abs(b-median))[0];
 const lineGap=nearest-obs.line;
 const flags:MarketFlag[]=[];
 if(Math.abs(lineGap)>=LAGGING_LINE_GAP)flags.push('lagging_line');
 if(modelSide&&pMoreBooks!==null){
  const booksSide=pMoreBooks>=0.5?'more':'less',lean=Math.max(pMoreBooks,1-pMoreBooks);
  if(booksSide!==modelSide&&lean>=PROS_DISAGREE_MIN)flags.push('pros_disagree');
 }
 return {booksAtSameLine:same.length,pMoreBooks,nearestBookLine:nearest,lineGap,flags};
}
