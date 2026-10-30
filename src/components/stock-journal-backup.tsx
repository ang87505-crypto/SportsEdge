'use client';

import {useState,type ChangeEvent} from 'react';
import {inspectJournalBackup,MAX_BACKUP_BYTES,type BackupReview} from '@/lib/stocks/journal-backup';
import type {Journal} from '@/lib/stocks/journal';

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

export function StockJournalBackup({currentRaw,current,invalid,onRestore}:{
 currentRaw:string;current:Journal;invalid:boolean;
 onRestore:(journal:Journal,expectedRaw:string)=>void;
}){
 const [review,setReview]=useState<BackupReview|null>(null);
 const [expected,setExpected]=useState('');
 const [fileName,setFileName]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [error,setError]=useState('');
 const existing=current.trades.length+current.watchlist.length;
 async function selectFile(event:ChangeEvent<HTMLInputElement>){
  const file=event.currentTarget.files?.[0];
  event.currentTarget.value='';
  setReview(null);setConfirmed(false);setError('');setFileName('');
  if(!file)return;
  if(file.size>MAX_BACKUP_BYTES||file.size===0){setError('Select a nonempty JSON backup under 1 MB. No records were changed.');return;}
  try{
   const content=await file.text();
   const checked=inspectJournalBackup(content);
   setExpected(currentRaw);
   setFileName(file.name.slice(0,120));
   setReview(checked);
  }catch(e){setError(e instanceof Error?e.message:'Could not inspect the selected file.');}
 }
 function restore(){
  if(!review||!confirmed)return;
  if(currentRaw!==expected){
   setReview(null);setConfirmed(false);
   setError('Your journal changed while reviewing the backup. Choose the file again to avoid overwriting recent work.');
   return;
  }
  try{
   onRestore(review.journal,expected);
   setReview(null);setConfirmed(false);setFileName('');
   setError('');
  }catch(e){setError(e instanceof Error?e.message:'Restore failed. The existing journal was not replaced.');}
 }
 return <section className="glass panel journal-backup-panel" aria-labelledby="journal-backup-title">
  <div className="journal-backup-heading"><div><h2 id="journal-backup-title">Back up or restore this journal</h2></div><span className="pill">Local files only</span></div>
  <p>The watchlist and virtual trades are stored only in this browser. Export a JSON backup before clearing browser data, switching devices, or restoring another file.</p>
  <div className="journal-backup-steps">
   <div><strong>Save a copy</strong><span>Use Export journal at the top of the page. Keep the JSON file somewhere safe.</span></div>
   <div><strong>Review a backup</strong><span>Select an exported SportsEdge JSON file. We validate its structure and amounts before making changes.</span></div>
   <div><strong>Restore deliberately</strong><span>Restoring <b>replaces</b> this browser&apos;s current manual watchlist and journal; it does not combine accounts or touch Alpaca.</span></div>
  </div>
  <label className="journal-backup-picker">Choose exported journal JSON
   <input type="file" accept=".json,application/json" onChange={event=>void selectFile(event)} aria-label="Choose journal backup JSON"/>
  </label>
  {invalid&&<div className="notice" role="status"><strong>Local journal validation failed.</strong> Export the existing raw file before restoring. A verified backup can replace it only after your explicit confirmation.</div>}
  {error&&<p className="error" role="alert">{error}</p>}
  {review&&<div className="journal-backup-review" aria-live="polite">
   <strong>Backup validated: {fileName}</strong>
   <div className="journal-backup-summary">
    <span>{review.watchlistCount} watched symbols</span><span>{review.tradeCount} total trades</span>
    <span>{review.openCount} open / {review.closedCount} closed</span><span>Realized P&amp;L {money(review.realizedCents)}</span>
   </div>
   <p><strong>Important:</strong> This action replaces {invalid?'the unreadable current journal':`${current.watchlist.length} current symbols and ${current.trades.length} current trades`} in this browser. It will not update Supabase or Alpaca.</p>
   <label className="journal-backup-confirm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
    <span>I have saved a copy of my existing journal and want to replace it with this validated backup.</span>
   </label>
   <div className="button-row"><button type="button" className="button" disabled={!confirmed} onClick={restore}>Replace local journal with backup</button>
    <button type="button" className="button button-secondary" onClick={()=>{setReview(null);setConfirmed(false);setError('');}}>Cancel</button></div>
  </div>}
  {existing>0&&!review&&<p className="journal-backup-foot">Current device: {current.watchlist.length} watched symbols and {current.trades.length} recorded trades. Export regularly; there is no cloud synchronization.</p>}
 </section>;
}
