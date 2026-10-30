"use client";
import {useState,type FormEvent} from 'react';
import Link from 'next/link';
import {StockJournalInsights} from '@/components/stock-journal-insights';
import {StockJournalBackup} from '@/components/stock-journal-backup';
import {inspectJournalBackup} from '@/lib/stocks/journal-backup';
import {PageHeading,Panel,Metric,MetricGrid,Empty,Details,Segmented,Badge,Callout} from '@/components/ui';
import {ticker,cents,totals,openTrade,closeTrade,INITIAL_CENTS,type Journal} from '@/lib/stocks/journal';
import {useJournal,journalSnapshot,writeJournal} from '@/lib/stocks/journal-store';
import {usdCents,dateTime} from '@/lib/format';

type Tab='journal'|'watchlist';

export default function StockJournal(){
 const {raw,journal:j,invalid}=useJournal();
 const [message,setMessage]=useState<{tone:'positive'|'negative';text:string}|null>(null);
 const [tab,setTab]=useState<Tab>('journal');
 const balance=totals(j);
 function save(next:Journal){if(invalid)throw Error('Saved data could not be read. Export it before making changes.');if(journalSnapshot()!==raw)throw Error('Your journal changed in another tab. Try again.');writeJournal(next);}
 function act(fn:()=>string){try{setMessage({tone:'positive',text:fn()});}catch(e){setMessage({tone:'negative',text:e instanceof Error?e.message:'Could not save to this browser.'});}}
 function watch(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,d=new FormData(form);act(()=>{const s=ticker(String(d.get('symbol')));if(j.watchlist.includes(s))throw Error('That ticker is already on your watchlist.');if(j.watchlist.length>=100)throw Error('The watchlist limit is 100 tickers.');save({...j,watchlist:[...j.watchlist,s]});form.reset();return `${s} added to your watchlist.`;});}
 function open(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,d=new FormData(form);act(()=>{const next=openTrade(j,{id:crypto.randomUUID(),symbol:String(d.get('symbol')),shares:Number(d.get('shares')),entryCents:cents(String(d.get('price'))),openedAt:new Date().toISOString(),note:String(d.get('note')??'').slice(0,500)});save(next);form.reset();return 'Virtual position recorded at your entered price.';});}
 function close(e:FormEvent<HTMLFormElement>,id:string){e.preventDefault();const d=new FormData(e.currentTarget);act(()=>{save(closeTrade(j,id,cents(String(d.get('exit'))),new Date().toISOString()));return 'Position closed. Realized profit or loss updated.';});}
 function download(){const b=new Blob([raw],{type:'application/json'}),url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download='sportsedge-stock-journal.json';a.click();URL.revokeObjectURL(url);}
 function restoreBackup(next:Journal,expected:string){
  if(journalSnapshot()!==expected)throw Error('The local journal changed while the backup was being reviewed. Import again to avoid losing updates.');
  const verified=inspectJournalBackup(JSON.stringify(next)).journal;
  writeJournal(verified);
  setMessage({tone:'positive',text:'Validated manual journal backup restored on this device. Nothing was sent to Alpaca.'});
 }
 const realizedTone=balance.realized>0?'positive':balance.realized<0?'negative':undefined;
 return <>
  <PageHeading title="Practice journal" description="Record your own stock ideas and virtual trades at prices you enter. Stored only in this browser. Not connected to Alpaca, market prices or the research strategy."
   action={<button type="button" className="button button-secondary" onClick={download}>Export journal</button>}/>
  <Callout tone="info" title="Manual practice, saved in this browser">Prices you enter are unverified assumptions, not fills. Export a backup before clearing browser data or switching devices.</Callout>

  <MetricGrid columns={4}>
   <Metric label="Available virtual cash" value={usdCents(balance.cash)} evidence="local" detail={`Starts at ${usdCents(INITIAL_CENTS)}`}/>
   <Metric label="Open positions at cost" value={usdCents(balance.cost)} detail={`${balance.open} open, not marked to market`}/>
   <Metric label="Realized P&L" value={usdCents(balance.realized,{signed:true})} tone={realizedTone} detail={`${balance.closed} closed at your prices`}/>
   <Metric label="Watchlist" value={j.watchlist.length} detail="Tickers saved on this device"/>
  </MetricGrid>

  {invalid&&<Callout tone="negative" role="alert" title="Your saved journal could not be read">Export it to keep a copy. Changes are disabled to protect the existing data.</Callout>}
  {message&&<p className={message.tone==='positive'?'success journal-message':'error journal-message'} role="status">{message.text}</p>}

  <div className="board-toolbar">
   <Segmented label="Journal section" value={tab} onChange={setTab} options={[{value:'journal',label:'Trades',count:j.trades.length},{value:'watchlist',label:'Watchlist',count:j.watchlist.length}]}/>
   <Badge tone="neutral">No stock price feed</Badge>
  </div>

  {tab==='watchlist'?<div className="split-2-1">
   <Panel title="Watchlist" description="Tickers you want to research. No prices or recommendations are shown.">
    <form onSubmit={watch} className="inline-form"><label><span className="sr-only">Ticker to watch</span><input name="symbol" aria-label="Ticker to watch" placeholder="Ticker, e.g. AAPL" maxLength={10} required/></label><button className="button" disabled={invalid}>Add ticker</button></form>
    {j.watchlist.length?<ul className="watchlist">{j.watchlist.map(s=><li key={s}><strong>{s}</strong><span className="quiet">No live price</span>
     <button type="button" className="remove-button" aria-label={`Remove ${s} from watchlist`} onClick={()=>act(()=>{save({...j,watchlist:j.watchlist.filter(x=>x!==s)});return `${s} removed from watchlist.`;})}>Remove</button></li>)}</ul>
     :<Empty title="Start with one company">Add a ticker above. It stays here when you return in this browser.</Empty>}
   </Panel>
   <Panel title="Before you record a trade" description="Three questions that make a practice trade worth reviewing later.">
    <ol className="checklist"><li><strong>What is the idea?</strong><span>What do you expect to change, and why?</span></li><li><strong>What would prove it wrong?</strong><span>A price or event that would make you exit.</span></li><li><strong>How will you measure it?</strong><span>Record entry, exit and reasoning the same way every time.</span></li></ol>
    <button type="button" className="button button-secondary" onClick={()=>setTab('journal')}>Record a practice trade</button>
   </Panel>
  </div>:<>
   <Panel title="Record a virtual position" description="Long positions only, whole shares, at the price you enter. No order is sent anywhere.">
    <form className="form-grid" onSubmit={open}>
     <label>Ticker<input name="symbol" placeholder="e.g. AAPL" required maxLength={10}/></label>
     <label>Whole shares<input name="shares" type="number" min="1" max="100000" step="1" required placeholder="10"/></label>
     <label>Entry price (USD)<input name="price" inputMode="decimal" required placeholder="Price you observed"/><span className="field-hint">Up to two decimals</span></label>
     <label>Price source and reason<textarea name="note" maxLength={500} placeholder="Where did this price come from? What is the idea?" required/></label>
     <div className="full"><button className="button" disabled={invalid}>Record virtual position</button></div>
    </form>
   </Panel>
   <Panel title="Trades" description="All prices were entered manually." flush>
    {!j.trades.length?<Empty title="No practice trades yet">Record a position above. Profit or loss appears after you close it.</Empty>:<div className="table-wrap"><table className="data-table ledger-table">
     <thead><tr><th scope="col">Position</th><th scope="col" className="num">Entry</th><th scope="col">Status</th><th scope="col">Exit and realized P&amp;L</th></tr></thead>
     <tbody>{[...j.trades].reverse().map(t=>{const pnl=t.exitCents===undefined?null:(t.exitCents-t.entryCents)*t.shares;return <tr key={t.id}>
      <td data-label="Position"><strong>{t.symbol}</strong>, {t.shares} shares<small>{dateTime(t.openedAt)}</small>{t.note&&<small>{t.note}</small>}</td>
      <td data-label="Entry" className="num">{usdCents(t.entryCents)}<small>Total {usdCents(t.entryCents*t.shares)}</small></td>
      <td data-label="Status"><Badge tone={t.exitCents===undefined?'info':'neutral'}>{t.exitCents===undefined?'Open':'Closed'}</Badge></td>
      <td data-label="Exit">{t.exitCents===undefined?<form onSubmit={e=>close(e,t.id)} className="inline-form"><input name="exit" aria-label={`Exit price for ${t.symbol}`} placeholder="Exit price" inputMode="decimal" required/><button className="button button-secondary button-sm" disabled={invalid}>Close</button></form>
       :<>{usdCents(t.exitCents)}<small className={pnl!>0?'tone-text-positive':pnl!<0?'tone-text-negative':undefined}>Realized {usdCents(pnl,{signed:true})}</small></>}</td>
     </tr>;})}</tbody>
    </table></div>}
   </Panel>
  </>}

  <StockJournalInsights journal={j} invalid={invalid}/>
  <StockJournalBackup currentRaw={raw} current={j} invalid={invalid} onRestore={restoreBackup}/>
  <Details title="What this journal measures"><p>Cash, open position cost and realized profit or loss from your entries. It does not include live valuations, fees, slippage, dividends, splits, short selling or execution checks. Manual records do not validate an automated strategy.</p><p>Limits: 100 watchlist symbols and 500 positions per browser. Nothing syncs to Supabase or other users. The <Link href="/stocks/alpaca">Alpaca paper account</Link> and the <Link href="/stocks/research">research strategy</Link> are separate.</p></Details>
 </>;
}
