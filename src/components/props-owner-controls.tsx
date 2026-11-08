'use client';
import {useCallback,useEffect,useState,useTransition,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {Badge,Panel} from '@/components/ui';
import {ownerKeyInput,ownerSignInError,OWNER_KEY_HINT} from '@/lib/owner-sign-in';

export const PROPS_WORKFLOW='https://github.com/ang87505-crypto/SportsEdge/actions/workflows/props-daily.yml';
type State='RUNNING'|'PAUSED'|'STOPPED';
type Model={active:string;previous:string|null;learningEnabled:boolean;autoSwitchEnabled:boolean;challengers:{version:string;state:string}[]}|null;
type View={kind:'checking'}|{kind:'login'}|{kind:'unconfigured'}|{kind:'error'}|{kind:'ready';state:State;reason:string;model:Model};
type Body={action:string;reason:string;version?:string};
const modelName=(v:string)=>v==='props-nb-minutes-rate-v1'?'the stats model':v.replace(/^props-learn-v/,'learning model v');
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
   const d=await r.json().catch(()=>null) as {status?:string;control?:{state:State;reason:string};model?:Model}|null;
   if(r.status===401)return setView({kind:'login'});
   if(r.status===503&&d?.status==='props_not_configured')return setView({kind:'unconfigured'});
   if(!r.ok||!d?.control||!(d.control.state in STATE_TEXT))return setView({kind:'error'});
   setView({kind:'ready',state:d.control.state,reason:d.control.reason,model:d.model??null});
  }catch{setView({kind:'error'});}
 },[]);
 useEffect(()=>{const t=window.setTimeout(()=>void read(),0);return()=>window.clearTimeout(t);},[read]);

 async function send(body:Body,confirmText:string,done:string){
  if(!window.confirm(confirmText))return;
  setBusy(true);setMsg(null);
  try{
   const r=await fetch('/api/internal/props/control',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   const d=await r.json().catch(()=>null) as {status?:string;code?:string}|null;
   if(r.status===401){setView({kind:'login'});setMsg('Your owner session expired. Sign in again.');return;}
   if(d?.status==='learn_dispatch_not_configured')setMsg('Retrain now needs the GitHub dispatch token in Vercel. You can run kind "train" on the NBA props learning loop workflow instead.');
   else if(r.ok)setMsg(done);
   else if(d?.status==='outcome_unknown')setMsg('The database did not confirm the change. Check the status, then try again. Retrying is safe.');
   else setMsg(`Not changed${d?.code?` (${d.code})`:''}.`);
  }catch{setMsg('The request did not complete. Check the status, then try again. Retrying is safe.');}
  finally{setBusy(false);await read();startTransition(()=>router.refresh());}
 }

 return <Panel title="Controls" id="props-owner-controls" description="Pause or resume here. Running a collection or settlement by hand happens on GitHub (steps below)." className="mt-12">
  {view.kind==='checking'&&<p className="quiet">Checking owner access…</p>}
  {view.kind==='login'&&<Unlock onDone={()=>void read()}/>}
  {view.kind==='unconfigured'&&<p className="quiet">This deployment has no props ledger, so there is nothing to control here.</p>}
  {view.kind==='error'&&<p className="quiet">The control could not be read. <button type="button" className="text-link" onClick={()=>void read()}>Try again</button></p>}
  {view.kind==='ready'&&<>
   <div className="props-control-state"><Badge tone={STATE_TEXT[view.state].tone} dot>{STATE_TEXT[view.state].label}</Badge><span className="quiet">{view.reason}</span></div>
   <div className="button-row">
    {ACTIONS.filter(a=>a.to!==view.state).map(a=><button key={a.action} type="button" disabled={busy}
     className={a.secondary?'button button-secondary':'button'}
     onClick={()=>void send({action:a.action,reason:a.reason},a.confirm,`Done: ${STATE_TEXT[a.to].label.toLowerCase()}.`)}>{a.label}</button>)}
   </div>
   {view.model&&<LearningControls model={view.model} busy={busy} send={send}/>}
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

function LearningControls({model,busy,send}:{model:NonNullable<Model>;busy:boolean;send:(b:Body,c:string,d:string)=>Promise<void>}){
 const eligible=model.challengers.filter(c=>c.state==='eligible'&&c.version!==model.active);
 return <div style={{marginTop:16}}>
  <h3 className="props-subhead">Learning</h3>
  <p className="quiet" style={{margin:'0 0 8px'}}>Active: {modelName(model.active)}. Learning is {model.learningEnabled?'on':'off'}; auto-switch is {model.autoSwitchEnabled?'on':'off'}.</p>
  <div className="button-row">
   <button type="button" className="button button-secondary" disabled={busy} aria-label={`Learning: turn ${model.learningEnabled?'off':'on'}`}
    onClick={()=>void send({action:model.learningEnabled?'learning_off':'learning_on',reason:`Learning turned ${model.learningEnabled?'off':'on'} from the website`},
     model.learningEnabled?'Turn learning off? The current model stays frozen until you turn it back on.':'Turn learning on? A new challenger is trained every Sunday.',
     `Done: learning ${model.learningEnabled?'off':'on'}.`)}>Learning: {model.learningEnabled?'turn off':'turn on'}</button>
   <button type="button" className="button button-secondary" disabled={busy} aria-label={`Auto-switch: turn ${model.autoSwitchEnabled?'off':'on'}`}
    onClick={()=>void send({action:model.autoSwitchEnabled?'auto_off':'auto_on',reason:`Auto-switch turned ${model.autoSwitchEnabled?'off':'on'} from the website`},
     model.autoSwitchEnabled?'Turn auto-switch off? A challenger that passes will wait for your approval.':'Turn auto-switch on? A challenger that passes the test takes over by itself.',
     `Done: auto-switch ${model.autoSwitchEnabled?'off':'on'}.`)}>Auto-switch: {model.autoSwitchEnabled?'turn off':'turn on'}</button>
   <button type="button" className="button button-secondary" disabled={busy}
    onClick={()=>void send({action:'retrain',reason:'Retrain requested from the website'},'Start a training run now on GitHub? It takes a few minutes and never changes the active model by itself.',
     'Started: a training run is on its way. Refresh in a few minutes.')}>Retrain now</button>
   {eligible.map(c=><button key={c.version} type="button" className="button" disabled={busy}
    onClick={()=>void send({action:'approve',version:c.version,reason:'Approved from the website'},`Switch to ${modelName(c.version)}? It passed the test; new picks will use it and go to the v2 virtual accounts.`,
     `Done: ${modelName(c.version)} is active.`)}>Approve switch to {modelName(c.version)}</button>)}
   {model.previous&&<button type="button" className="button button-secondary" disabled={busy}
    onClick={()=>void send({action:'rollback',reason:'Rolled back from the website'},`Roll back to ${modelName(model.previous!)}? New picks will use it right away.`,
     `Done: rolled back to ${modelName(model.previous!)}.`)}>Roll back to {modelName(model.previous)}</button>}
  </div>
 </div>;
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
