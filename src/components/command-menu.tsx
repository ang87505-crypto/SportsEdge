"use client";

import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {NavIcon,type NavIconName} from '@/components/nav-icon';

type Destination={title:string;description:string;href:string;group:'Workspaces'|'Research & tools';icon:NavIconName};
const destinations:Destination[]=[
 {title:'Overview',description:'Your research workspace at a glance',href:'/',group:'Workspaces',icon:'home'},
 {title:'Sports intelligence',description:'NBA and EPL games, recorded odds and models',href:'/sports',group:'Workspaces',icon:'sports'},
 {title:'Stocks',description:'Watchlists and virtual stock journal',href:'/stocks',group:'Workspaces',icon:'stocks'},
 {title:'Paper betting',description:'Shared NBA virtual-money ledger',href:'/paper-betting',group:'Workspaces',icon:'paper'},
 {title:'Project research progress',description:'All evidence gates and milestones in one place',href:'/progress',group:'Research & tools',icon:'spark'},
 {title:'Stock algorithm research',description:'Registered strategy and backtest readiness',href:'/stocks/research',group:'Research & tools',icon:'stocks'},
 {title:'NBA model research',description:'Historical model evaluation',href:'/research/nba',group:'Research & tools',icon:'research'},
 {title:'EPL model research',description:'Soccer research and limitations',href:'/research/epl',group:'Research & tools',icon:'research'},
 {title:'Testing center',description:'One walkthrough for the platform and private Alpaca readiness',href:'/testing',group:'Research & tools',icon:'shield'},
 {title:'Guide & limitations',description:'Learn the platform and its data boundaries',href:'/guide',group:'Research & tools',icon:'guide'}
];

export function CommandMenu(){
 const dialog=useRef<HTMLDialogElement>(null);
 const search=useRef<HTMLInputElement>(null);
 const router=useRouter();
 const [query,setQuery]=useState('');
 const [selected,setSelected]=useState(0);
 const [open,setOpen]=useState(false);
 const filtered=destinations.filter(d=>(d.title+' '+d.description).toLowerCase().includes(query.trim().toLowerCase()));

 function show(){
  setQuery('');
  setSelected(0);
  if(!dialog.current?.open){dialog.current?.showModal();setOpen(true);}
  requestAnimationFrame(()=>search.current?.focus());
 }
 function hide(){
  dialog.current?.close();
  setOpen(false);
 }
 function go(href:string){hide();router.push(href);}
 useEffect(()=>{
  function onShortcut(event:KeyboardEvent){
   if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){
    event.preventDefault();
    if(dialog.current?.open){dialog.current.close();setOpen(false);}
    else {
     setQuery('');setSelected(0);dialog.current?.showModal();setOpen(true);
     requestAnimationFrame(()=>search.current?.focus());
    }
   }
  }
  document.addEventListener('keydown',onShortcut);
  return ()=>document.removeEventListener('keydown',onShortcut);
 },[]);
 function keyDown(event:React.KeyboardEvent<HTMLInputElement>){
  if(event.key==='ArrowDown'){event.preventDefault();setSelected(i=>Math.min(i+1,filtered.length-1));}
  if(event.key==='ArrowUp'){event.preventDefault();setSelected(i=>Math.max(0,i-1));}
  if(event.key==='Enter'&&filtered.length){event.preventDefault();go(filtered[Math.min(selected,filtered.length-1)].href);}
 }
 return <>
  <button className="command-trigger" type="button" onClick={show} aria-label="Open quick navigation" aria-haspopup="dialog" aria-expanded={open}>
   <NavIcon name="search" size={17}/><span>Jump to...</span><kbd>⌘ K</kbd>
  </button>
  <dialog ref={dialog} className="command-dialog" aria-label="Quick navigation" onClose={()=>setOpen(false)} onClick={event=>{if(event.target===dialog.current)hide();}}>
   <div className="command-topline"><span className="command-top-mark">SE</span><span>QUICK NAVIGATION</span><button type="button" onClick={hide} aria-label="Close quick navigation">Esc</button></div>
   <label className="command-search-field">
    <NavIcon name="search" size={20}/>
    <input ref={search} value={query} onChange={e=>{setQuery(e.target.value);setSelected(0);}} onKeyDown={keyDown} type="search" placeholder="Where do you want to go?" aria-label="Search SportsEdge pages" aria-controls="command-results"/>
   </label>
   <div id="command-results" className="command-results" aria-live="polite">
    {filtered.length===0?<p className="command-empty">No matching pages. Try “stocks”, “NBA”, or “guide”.</p>:
     filtered.map((item,i)=><button key={item.href} type="button" className={selected===i?'command-result is-selected':'command-result'} onMouseEnter={()=>setSelected(i)} onClick={()=>go(item.href)}>
      <span className="command-result-icon"><NavIcon name={item.icon} size={19}/></span>
      <span className="command-result-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
      <span className="command-result-arrow" aria-hidden="true">↗</span>
     </button>)
    }
   </div>
   <p className="command-hint">Use ↑ ↓ to select · Enter to open · Esc to close</p>
  </dialog>
 </>;
}
