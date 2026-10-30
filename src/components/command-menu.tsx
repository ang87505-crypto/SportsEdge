"use client";

import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {NavIcon,type NavIconName} from '@/components/nav-icon';
import {SECTIONS,PLATFORM} from '@/lib/navigation';

type Destination={title:string;description:string;href:string;group:string;icon:NavIconName};
// Built from the navigation config so search can never point to a route the sidebar does not have.
const destinations:Destination[]=[
 ...SECTIONS.flatMap(section=>[
  {title:section.label,description:section.description,href:section.href,group:section.label,icon:section.icon},
  ...section.children.map(child=>({title:child.label,description:child.description,href:child.href,group:section.label,icon:section.icon}))
 ]),
 ...PLATFORM.map(item=>({title:item.label,description:item.description,href:item.href,group:'Platform',icon:item.icon}))
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
   <NavIcon name="search" size={16}/><span>Search pages</span><kbd>Ctrl K</kbd>
  </button>
  <dialog ref={dialog} className="command-dialog" aria-label="Quick navigation" onClose={()=>setOpen(false)} onClick={event=>{if(event.target===dialog.current)hide();}}>
   <div className="command-topline"><span>Go to a page</span><button type="button" onClick={hide} aria-label="Close quick navigation">Esc</button></div>
   <label className="command-search-field">
    <NavIcon name="search" size={20}/>
    <input ref={search} value={query} onChange={e=>{setQuery(e.target.value);setSelected(0);}} onKeyDown={keyDown} type="search" placeholder="Search Sports AI, paper bets, stocks…" aria-label="Search SportsEdge pages" aria-controls="command-results"/>
   </label>
   <div id="command-results" className="command-results" aria-live="polite">
    {filtered.length===0?<p className="command-empty">No matching pages. Try “stocks”, “NBA” or “paper”.</p>:
     filtered.map((item,i)=><button key={item.href} type="button" data-href={item.href} className={selected===i?'command-result is-selected':'command-result'} onMouseEnter={()=>setSelected(i)} onClick={()=>go(item.href)}>
      <span className="command-result-icon"><NavIcon name={item.icon} size={19}/></span>
      <span className="command-result-copy"><strong>{item.title}</strong><small>{item.description}</small></span>
      <span className="command-result-group">{item.group}</span>
     </button>)
    }
   </div>
   <p className="command-hint"><kbd>↑</kbd><kbd>↓</kbd> select <kbd>Enter</kbd> open <kbd>Esc</kbd> close</p>
  </dialog>
 </>;
}
