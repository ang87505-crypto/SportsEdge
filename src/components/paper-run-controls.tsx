'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
type SportsPreview = {
  predictions?: {starts_at?: string}[];
};
type OddsPreview = {
  status?: string;
  games?: {startsAt?: string;bookmakers?: {updatedAt?: string}[]}[];
};

type Access={configured:boolean;owner:boolean;enabled:boolean;stocksReady:boolean};
const pendingKey='sportsedge:pending-nba-command-v1';
export function PaperRunControls({market:track}:{market:'sports'|'stocks'}){
 const router=useRouter(),[access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('Checking paper controls…'),[auto,setAuto]=useState(false),[checked,setChecked]=useState('');
 const working=useRef(false);
 const [pendingId,setPendingId]=useState<string|null>(null);
 useEffect(()=>{let active=true;queueMicrotask(()=>{if(!active||track!=='sports')return;try{const value=window.sessionStorage.getItem(pendingKey);if(value){setPendingId(value);setMessage('A previous NBA command needs verification before another batch. Use Check command status below.');}}catch{setMessage('Browser storage is unavailable. New owner runs are disabled until your browser can safely remember a command ID.');}});return()=>{active=false;};},[track]);
 const check=useCallback(async()=>{try{const r=await fetch('/api/paper-control',{cache:'no-store'});if(!r.ok)throw Error();setAccess(await r.json());setMessage('');}catch{setMessage('Paper controls are temporarily unavailable.');}},[]);
 useEffect(()=>{let active=true;fetch('/api/paper-control',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const data=await r.json();if(active){setAccess(data);setMessage('');}}).catch(()=>{if(active)setMessage('Paper controls are temporarily unavailable.');});return()=>{active=false;};},[]);
 const execute=useCallback(async(action:'run'|'refresh')=>{
  if(working.current)return;working.current=true;setBusy(true);
  if(action==='run'&&pendingId){setMessage('Check the previous command status before starting another batch. ID: '+pendingId);working.current=false;setBusy(false);return;}
  const commandId=track==='sports'&&action==='run'?crypto.randomUUID():undefined;
  if(commandId){try{window.sessionStorage.setItem(pendingKey,commandId);setPendingId(commandId);}catch{setMessage('Cannot safely preserve the command ID in this browser; no run was started.');working.current=false;setBusy(false);return;}}
  try{const r=await fetch('/api/paper-control',{method:'POST',headers:{'Content-Type':'application/json','X-SportsEdge-Control':'1'},body:JSON.stringify({track,action,...(commandId?{commandId}:{})})});const d=await r.json();
   if(!r.ok){if(r.status===401){setAccess(a=>a?{...a,owner:false}:a);}throw Error((d.error??'The run could not finish.')+(commandId?' Command ID: '+commandId:''));}
   if(commandId){try{window.sessionStorage.removeItem(pendingKey);}catch{}setPendingId(null);}
   const result=d.result;
   setMessage(action==='run'?`${d.replayed?'Previously completed command (no additional batch): ':''}${result.positionIds.length} position(s) confirmed; ${result.alreadyRecordedPositionIds.length} already recorded; ${result.skippedGames.length} skipped; ${result.failedGames.length} need review. Confirmed positions may already have been recorded by another run. No fresh quote means no new bet.`:`${result.settledPositions} position(s) settled. ${result.unavailableGames.length} game result(s) still unavailable.`);
   setChecked(d.checkedAt);router.refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'The run could not finish.');setAuto(false);router.refresh();}
  finally{working.current=false;setBusy(false);}
 },[router,track,pendingId]);
 const checkCommand=useCallback(async()=>{
  if(!pendingId||working.current)return;working.current=true;setBusy(true);
  try{
   const response=await fetch('/api/paper-control?commandId='+encodeURIComponent(pendingId),{cache:'no-store',headers:{Accept:'application/json'}});
   const data=await response.json();
   if(!response.ok)throw Error(data.error??'Could not check command state.');
   if(data.state==='completed'){
    try{window.sessionStorage.removeItem(pendingKey);}catch{}
    setPendingId(null);
    setMessage('Previous command verified as completed. Its recorded result is now available in the paper ledger. You may start a new, separate batch if you intend to.');router.refresh();
   }else if(data.state==='running'||data.state==='uncertain'){
    setMessage('This command is '+data.state+'. Do not start another run; reconcile the ledger with an operator. Command ID: '+pendingId);
   }else{
    setMessage('No durable receipt is currently visible for this command. Do not assume it was never received; allow pending requests to finish and recheck. Command ID: '+pendingId);
   }
  }catch(e){setMessage((e instanceof Error?e.message:'Command lookup unavailable.')+' Keep the original command ID: '+pendingId);}
  finally{working.current=false;setBusy(false);}
 },[pendingId,router]);
 useEffect(()=>{if(track!=='sports'||!auto||!access?.owner||!access.enabled)return;const timer=setInterval(()=>{void execute('refresh');},60000);return()=>clearInterval(timer);},[track,auto,access?.owner,access?.enabled,execute]);
 async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();if(working.current)return;const form=e.currentTarget,data=new FormData(form);working.current=true;setBusy(true);
  try{const r=await fetch('/api/paper-control/session',{method:'POST',headers:{'Content-Type':'application/json','X-SportsEdge-Control':'1'},body:JSON.stringify({action:'login',email:data.get('email'),password:data.get('password')})});const d=await r.json();form.reset();if(!r.ok)throw Error(d.error);await check();}catch(e){setMessage(e instanceof Error?e.message:'Sign-in failed.');}finally{working.current=false;setBusy(false);}}
 async function logout(){if(working.current)return;working.current=true;setBusy(true);try{const r=await fetch('/api/paper-control/session',{method:'POST',headers:{'Content-Type':'application/json','X-SportsEdge-Control':'1'},body:'{"action":"logout"}'});if(!r.ok)throw Error();setAccess(a=>a?{...a,owner:false}:a);setMessage('Signed out.');}catch{setMessage('Sign-out could not be confirmed.');}finally{working.current=false;setBusy(false);}}
  async function checkReadiness() {
    if(working.current)return;working.current=true;
    setBusy(true);setMessage('');
    try {
      if(track!=='sports') {
        setMessage("Blocked: no independently verified stock-price feed, owner account, durable $1,000 stock execution ledger, or approved model-run adapter is connected. The existing manual stock journal is unaffected.");
        return;
      }
      const responses=await Promise.all([
        fetch("/api/research",{cache:"no-store",headers:{Accept:"application/json"}}),
        fetch("/api/sports?sport=nba",{cache:"no-store",headers:{Accept:"application/json"}})
      ]);
      if(responses.some(r=>!r.ok))throw new Error("Stored data is temporarily unavailable.");
      const research=(await responses[0].json()) as SportsPreview;
      const feed=(await responses[1].json()) as OddsPreview;
      if(!Array.isArray(research.predictions)||feed.status!=="stored"||!Array.isArray(feed.games))throw new Error("Stored data is incomplete.");
      const now=Date.now(),freshCutoff=now-3_600_000;
      const upcoming=research.predictions.filter(f=>f.starts_at&&Number.isFinite(Date.parse(f.starts_at))&&Date.parse(f.starts_at)>now).length;
      const observations=feed.games.filter(g=>g.startsAt&&Date.parse(g.startsAt)>now)
        .flatMap(g=>Array.isArray(g.bookmakers)?g.bookmakers:[])
        .filter(q=>{const t=q.updatedAt?Date.parse(q.updatedAt):NaN;return Number.isFinite(t)&&t<=now&&t>=freshCutoff;}).length;
      setMessage("Read-only data check: "+upcoming+" future NBA forecast(s) and "+observations+" recently observed displayed moneyline quote(s). This does not establish complete markets, positive expected value or executable prices. This read-only check placed no paper wager.");
    } catch {
      setMessage("Could not verify stored research and odds right now. No paper positions were created or modified.");
    } finally {
      working.current=false;setBusy(false);
    }
  }
 return <section className="glass panel" aria-label={`${track} paper trading controls`} style={{marginBottom:24}}>
  <span className="pill">Virtual money only · owner controls</span><h2 style={{marginTop:12}}>{track==='sports'?'Run NBA paper bets':'Automated stock study · $1,000 planned'}</h2>
  <p>{track==='sports'?'Each Run click creates one unique command ID, which must be recorded in the database before the existing NBA runner can start. Replayed requests never launch a second batch. Up to 10 qualifying forecasts are examined using the existing 1% cash rule. If a write is uncertain, stop and reconcile before another run. The separate 100 × $10 proposal is not active; no sportsbook quotes are refreshed here.':'This separate study will use the stock model to choose positions. Your manual $10,000 journal below stays separate.'}</p>
  <button type="button" className="button button-secondary" disabled={busy} onClick={()=>void checkReadiness()}>Check readiness</button>
  {track==='stocks'&&<p className="notice"><strong>Not connected.</strong> Verified stock prices, persistent accounting and the signal adapter are still required. No automated stock balance or return is available.</p>}
  {access&&!access.configured&&<p className="notice">Owner sign-in needs setup before these controls can run.</p>}
  {access?.configured&&!access.owner&&<form onSubmit={login} className="form-grid"><label>Owner email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024}/></label><div><button className="button button-secondary" disabled={busy}>Sign in</button></div></form>}
  {access?.owner&&<><div className="button-row"><button className="button" disabled={busy||Boolean(pendingId)||!access.enabled||track==='stocks'} onClick={()=>void execute('run')}>{busy?'Working…':track==='sports'?'Run paper bets':'Run stock paper trades'}</button>{track==='sports'&&<button className="button button-secondary" disabled={busy||!access.enabled} onClick={()=>void execute('refresh')}>Check final results</button>}<button className="button button-secondary" disabled={busy} onClick={()=>void logout()}>Sign out</button></div>{track==='sports'&&pendingId&&<div className="notice" role="status"><strong>Previous command requires review.</strong> No new batch can be started from this browser until the same command has a confirmed result. <span style={{overflowWrap:'anywhere'}}>ID: {pendingId}</span><div style={{marginTop:12}}><button type="button" className="button button-secondary" disabled={busy} onClick={()=>void checkCommand()}>Check existing command status</button></div></div>}{!access.enabled&&<p>Execution is disabled pending release review.</p>}{track==='sports'&&<label style={{display:'flex',gap:10,marginTop:16,alignItems:'center'}}><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)} style={{width:'auto'}}/>Opt in to checking final results every minute while this page is open. New bets only run when you press Run; this does not refresh sportsbook quotes.</label>}</>}
  <p role="status" aria-live="polite" style={{marginTop:12}}>{message}</p>{checked&&<small>Last successful check: {new Date(checked).toLocaleString()}</small>}
 </section>;
}
