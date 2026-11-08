'use client';
import {useCallback,useEffect,useState,useTransition,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {Badge,Panel} from '@/components/ui';
import {ownerKeyInput,ownerSignInError,OWNER_KEY_HINT} from '@/lib/owner-sign-in';

export const PROPS_WORKFLOW='https://github.com/ang87505-crypto/SportsEdge/actions/workflows/props-daily.yml';
type State='RUNNING'|'PAUSED'|'STOPPED';
type View={kind:'checking'}|{kind:'login'}|{kind:'unconfigured'}|{kind:'error'}|{kind:'ready';state:State;reason:string};
const ACTIONS:{action:'pause'|'resume'|'stop';label:string;to:State;reason:string;confirm:string;secondary:boolean}[]=[
 {action:'resume',label:'Resume',to:'RUNNING',reason:'Resumed from the website',secondary:false,
  confirm:'Resume daily paper collection and settlement? Entries stay virtual.'},
 {action:'pause',label:'Pause',to:'PAUSED',reason:'Paused from the website',secondary:true,
  confirm:'Pause? New collection and settlement runs will be blocked until you resume.'},
 {action:'stop',label:'Stop',to:'STOPPED',reason:'Stopped from the website',secondary:true,
  confirm:'Stop? Nothing runs until you press Resume. Saved results are kept.'},
];
const STATE_TEXT:Record<State,{label:string;tone:'positive'|'warning'|'neutral'}>={
 RUNNING:{label:'Running',tone:'positive'},PAUSED:{label:'Paused',tone:'warning'},STOPPED:{label:'Stopped',tone:'neutral'}};

/** Owner Pause/Resume/Stop for the props paper worker, plus how to run a collection or settlement by hand. */
export function PropsOwnerControls(){
 const router=useRouter();
 const [view,setView]=useState<View>({kind:'checking'});
 const [msg,setMsg]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [,startTransition]=useTransition();
 const read=useCallback(async()=>{
  try{
   const r=await fetch('/api/internal/props/control',{cache:'no-store',credentials:'same-origin'});
   const d=await r.json().catch(()=>null) as {status?:string;control?:{state:State;reason:string}}|null;
   if(r.status===401)return setView({kind:'login'});
   if(r.status===503&&d?.status==='props_not_configured')return setView({kind:'unconfigured'});
   if(!r.ok||!d?.control||!(d.control.state in STATE_TEXT))return setView({kind:'error'});
   setView({kind:'ready',state:d.control.state,reason:d.control.reason});
  }catch{setView({kind:'error'});}
 },[]);
 useEffect(()=>{const t=window.setTimeout(()=>void read(),0);return()=>window.clearTimeout(t);},[read]);

 async function act(a:typeof ACTIONS[number]){
  if(!window.confirm(a.confirm))return;
  setBusy(true);setMsg(null);
  try{
   const r=await fetch('/api/internal/props/control',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({action:a.action,reason:a.reason})});
   const d=await r.json().catch(()=>null) as {status?:string;code?:string}|null;
   if(r.status===401){setView({kind:'login'});setMsg('Your owner session expired. Sign in again.');return;}
   if(r.ok)setMsg(`Done: ${STATE_TEXT[a.to].label.toLowerCase()}.`);
   else if(d?.status==='outcome_unknown')setMsg('The database did not confirm the change. Check the status, then try again. Retrying is safe.');
   else setMsg(`Not changed${d?.code?` (${d.code})`:''}.`);
  }catch{setMsg('The request did not complete. Check the status, then try again. Retrying is safe.');}
  finally{setBusy(false);await read();startTransition(()=>router.refresh());}
 }

 return <Panel title="Controls" description="Pause or resume here. Running a collection or settlement by hand happens on GitHub (steps below)." className="mt-12">
  {view.kind==='checking'&&<p className="quiet">Checking owner access…</p>}
  {view.kind==='login'&&<Unlock onDone={()=>void read()}/>}
  {view.kind==='unconfigured'&&<p className="quiet">This deployment has no props ledger, so there is nothing to control here.</p>}
  {view.kind==='error'&&<p className="quiet">The control could not be read. <button type="button" className="text-link" onClick={()=>void read()}>Try again</button></p>}
  {view.kind==='ready'&&<>
   <div className="props-control-state"><Badge tone={STATE_TEXT[view.state].tone} dot>{STATE_TEXT[view.state].label}</Badge><span className="quiet">{view.reason}</span></div>
   <div className="button-row">
    {ACTIONS.filter(a=>a.to!==view.state).map(a=><button key={a.action} type="button" disabled={busy}
     className={a.secondary?'button button-secondary':'button'} onClick={()=>void act(a)}>{a.label}</button>)}
   </div>
  </>}
  {msg&&<p className="quiet" role="status" style={{marginTop:8}}>{msg}</p>}
  <h3 className="props-subhead" style={{marginTop:16}}>Run something now (no AI needed)</h3>
  <ol className="props-steps">
   <li>Open <a className="text-link" href={PROPS_WORKFLOW} target="_blank" rel="noopener noreferrer">NBA props paper cycle on GitHub</a> and press <strong>Run workflow</strong>.</li>
   <li>Pick a <strong>Run kind</strong>: <code>collect</code> gets today&apos;s lines and records picks, <code>settle</code> grades finished games, <code>status</code> only reads. Pause, resume and stop work there too; type a short reason.</li>
   <li>Press the green <strong>Run workflow</strong> button, wait a minute or two, then refresh this page.</li>
  </ol>
  <p className="quiet small-print">The daily schedule already does collect and settle on its own. Use these only to catch up or to test.</p>
 </Panel>;
}

function Unlock({onDone}:{onDone:()=>void}){
 const [key,setKey]=useState('');const [msg,setMsg]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 async function submit(e:FormEvent){
  e.preventDefault();
  const ownerKey=ownerKeyInput(key);
  if(!ownerKey){setMsg(OWNER_KEY_HINT);return;}
  setBusy(true);setMsg(null);
  try{
   const r=await fetch('/api/internal/alpaca-paper/session',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({ownerKey})});
   const d=await r.json().catch(()=>null) as {reason?:unknown}|null;
   if(r.ok){setKey('');onDone();}else setMsg(ownerSignInError(r.status,d?.reason));
  }catch{setMsg(ownerSignInError(0));}
  finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="props-unlock">
  <p className="quiet">Sign in as the owner to pause or resume. Anyone can read the results.</p>
  <label className="field"><span>Owner key</span>
   <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)} placeholder="64-character key"/></label>
  <button type="submit" className="button" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
  {msg&&<p className="quiet" role="alert">{msg}</p>}
 </form>;
}
