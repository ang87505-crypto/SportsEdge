import {parseJournal,totals,type Journal} from './journal';

export const MAX_BACKUP_BYTES=1024*1024;
export type BackupReview={
 journal:Journal;
 watchlistCount:number;
 tradeCount:number;
 openCount:number;
 closedCount:number;
 realizedCents:number;
};
/**
 * Validate a user-selected SportsEdge v1 JSON backup before ANY write.
 * Never accept a shape other than the existing manual journal; no broker data,
 * executable content or server upload is involved.
 */
export function inspectJournalBackup(raw:string):BackupReview{
 if(typeof raw!=='string'||!raw.trim()||raw.length>MAX_BACKUP_BYTES)throw Error('Choose a nonempty SportsEdge journal JSON file smaller than 1 MB.');
 let unknown:unknown;
 try{unknown=JSON.parse(raw);}catch{throw Error('This file is not valid JSON. No data was changed.');}
 if(!unknown||typeof unknown!=='object'||Array.isArray(unknown))throw Error('The file is not a SportsEdge journal.');
 const value=unknown as Record<string,unknown>;
 const keys=Object.keys(value);
 if(keys.length!==3||!keys.every(key=>['version','watchlist','trades'].includes(key)))throw Error('The file does not match the SportsEdge v1 journal format.');
 if(value.version!==1||!Array.isArray(value.watchlist)||!Array.isArray(value.trades))throw Error('Only SportsEdge v1 journal backups are supported.');
 const seenSymbols=new Set<string>();
 for(const symbol of value.watchlist){
  if(typeof symbol!=='string'||seenSymbols.has(symbol))throw Error('The watchlist contains invalid or duplicate symbols.');
  seenSymbols.add(symbol);
 }
 for(const trade of value.trades){
  if(!trade||typeof trade!=='object'||Array.isArray(trade))throw Error('The backup contains an invalid trade.');
  const t=trade as Record<string,unknown>;
  const allowed=['id','symbol','shares','entryCents','openedAt','note','exitCents','closedAt'];
  const fields=Object.keys(t);
  if(fields.some(key=>!allowed.includes(key))||typeof t.id!=='string'||t.id.length<1||t.id.length>128||
     typeof t.symbol!=='string'||typeof t.openedAt!=='string'||typeof t.note!=='string'||
     typeof t.shares!=='number'||typeof t.entryCents!=='number')
    throw Error('The backup contains a trade with unexpected fields.');
  const closed=Object.hasOwn(t,'exitCents')||Object.hasOwn(t,'closedAt');
  if(closed&&(!Object.hasOwn(t,'exitCents')||!Object.hasOwn(t,'closedAt')||
     typeof t.exitCents!=='number'||typeof t.closedAt!=='string'))
    throw Error('A closed trade is missing its matching exit fields.');
 }
 let parsed:Journal;
 try{parsed=parseJournal(raw);}catch{throw Error('The backup failed journal validation. Your current records are unchanged.');}
 const totalsValue=totals(parsed);
 if(![totalsValue.cash,totalsValue.realized,totalsValue.cost].every(Number.isSafeInteger))
  throw Error('The backup contains amounts outside the safe accounting range.');
 return {
  journal:parsed,
  watchlistCount:parsed.watchlist.length,
  tradeCount:parsed.trades.length,
  openCount:totalsValue.open,
  closedCount:totalsValue.closed,
  realizedCents:totalsValue.realized
 };
}
