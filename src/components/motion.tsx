'use client';

import {useEffect,useRef,useState} from 'react';
import {usePathname} from 'next/navigation';
import {NavIcon} from '@/components/nav-icon';

/*
 * Page motion layer, mounted once by the shell.
 *
 * - Scroll reveal: blocks fade and rise into place as they enter the viewport; their bars grow,
 *   lines draw and figures slide up. Nothing is hidden unless JavaScript is running and the
 *   viewer allows motion (`html.motion-ok`), so content is always readable without it.
 * - Scroll progress bar, back-to-top button and a "Sections" jump menu with scroll-spy.
 * - A soft light that follows the pointer across interactive glass cards.
 *
 * It only toggles classes and CSS variables on elements; it never edits text React owns.
 */

const REVEAL='.content :is(.panel-v2, .glass, .metric-grid, .game-card-v2, .book-strip, .home-section-link, .section-header, .callout, .virtual-banner, .guide-section, .page-heading, .board-toolbar, .home-intro-copy, .stocks-top > *, .split-1-1 > *, .two-grid > *)';
const STAGGER=':is(.metric-grid, .track-grid, .home-sections, .status-list, .activity, .exposure-list, .rating-list, .three-way-list, .evidence-legend, .progress-card-grid, .test-status-grid, .guide-sections, .book-strip)';
const GLOW='.home-section-link, .book, .game-card-v2, .guide-section, .track, .progress-record, .test-status-card';

function reducedMotion(){return typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;}

function slug(text:string){return text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'section';}

export function MotionLayer(){
 const path=usePathname();
 const [progress,setProgress]=useState(0);
 const [showTop,setShowTop]=useState(false);
 const [scrolled,setScrolled]=useState(false);
 const [sections,setSections]=useState<{id:string;label:string}[]>([]);
 const [active,setActive]=useState<string|null>(null);
 const [menuOpen,setMenuOpen]=useState(false);
 const menuRef=useRef<HTMLDivElement>(null);

 // Scroll reveal, re-armed on every route and for content that streams in later.
 useEffect(()=>{
  const root=document.documentElement;
  if(reducedMotion()||!('IntersectionObserver' in window)){root.classList.remove('motion-ok');return;}
  root.classList.add('motion-ok');
  const main=document.getElementById('main-content');
  if(!main)return;
  let order=0;
  // State lives in data-reveal ("pending" | "in"), never in className: React rewrites className
  // when a component updates, which would silently drop a revealed state.
  const io=new IntersectionObserver(entries=>{
   for(const e of entries){
    if(!e.isIntersecting)continue;
    const el=e.target as HTMLElement;
    // Elements entering together cascade slightly instead of popping at once.
    el.style.setProperty('--reveal-delay',`${Math.min(order++,6)*55}ms`);
    el.dataset.reveal='in';
    io.unobserve(el);
   }
   order=0;
  },{rootMargin:'0px 0px -6% 0px',threshold:0.06});
  const arm=()=>{
   main.querySelectorAll<HTMLElement>(REVEAL).forEach(el=>{
    if(el.dataset.reveal==='in')return;
    // Nested targets ride along with their parent's reveal instead of animating twice.
    if(el.parentElement?.closest('[data-reveal]'))return;
    // A block left pending by the previous route's observer (client navigation can insert the
    // new page before the path changes) is observed again here, so it can never stay hidden.
    el.dataset.reveal='pending';
    io.observe(el);
   });
   main.querySelectorAll<HTMLElement>(STAGGER).forEach(list=>{
    Array.from(list.children).forEach((child,i)=>(child as HTMLElement).style.setProperty('--i',String(Math.min(i,12))));
   });
  };
  arm();
  const mo=new MutationObserver(()=>arm());
  mo.observe(main,{childList:true,subtree:true});
  return()=>{io.disconnect();mo.disconnect();};
 },[path]);

 // Scroll progress, back-to-top visibility and the active section.
 useEffect(()=>{
  let frame=0;
  const update=()=>{
   frame=0;
   const max=document.documentElement.scrollHeight-window.innerHeight;
   setProgress(max>0?Math.min(1,window.scrollY/max):0);
   setShowTop(window.scrollY>720);
   setScrolled(window.scrollY>320);
  };
  const onScroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
  update();
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',onScroll);
  return()=>{window.removeEventListener('scroll',onScroll);window.removeEventListener('resize',onScroll);if(frame)cancelAnimationFrame(frame);};
 },[path]);

 // Build the "Sections" menu from the page's own h2 headings.
 useEffect(()=>{
  const main=document.getElementById('main-content');
  if(!main)return;
  let spy:IntersectionObserver|null=null;
  const collect=()=>{
   const used=new Set<string>();
   const found:{id:string;label:string}[]=[];
   main.querySelectorAll<HTMLHeadingElement>('h2').forEach(h=>{
    const label=h.textContent?.trim();
    if(!label||h.closest('dialog,.drawer,.continue-nav'))return;
    if(!h.id){let id=slug(label),n=2;while(document.getElementById(id)||used.has(id))id=`${slug(label)}-${n++}`;h.id=id;}
    used.add(h.id);
    found.push({id:h.id,label});
   });
   setSections(prev=>prev.length===found.length&&prev.every((p,i)=>p.id===found[i].id&&p.label===found[i].label)?prev:found);
   spy?.disconnect();
   spy=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top);
    if(visible[0])setActive(visible[0].target.id);
   },{rootMargin:'-15% 0px -70% 0px'});
   found.forEach(s=>{const el=document.getElementById(s.id);if(el)spy!.observe(el);});
  };
  const timer=window.setTimeout(collect,60);
  let t2=0;
  const mo=new MutationObserver(()=>{window.clearTimeout(t2);t2=window.setTimeout(collect,200);});
  mo.observe(main,{childList:true,subtree:true});
  return()=>{window.clearTimeout(timer);window.clearTimeout(t2);mo.disconnect();spy?.disconnect();};
 },[path]);

 // Close the Sections menu on route change, outside click or Escape.
 useEffect(()=>{
  if(!menuOpen)return;
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setMenuOpen(false);};
  const onDown=(e:PointerEvent)=>{if(menuRef.current&&!menuRef.current.contains(e.target as Node))setMenuOpen(false);};
  document.addEventListener('keydown',onKey);
  document.addEventListener('pointerdown',onDown);
  return()=>{document.removeEventListener('keydown',onKey);document.removeEventListener('pointerdown',onDown);};
 },[menuOpen]);
 const [menuPath,setMenuPath]=useState(path);
 if(menuPath!==path){setMenuPath(path);setMenuOpen(false);}

 // Pointer-follow light on interactive cards (one delegated listener).
 useEffect(()=>{
  if(reducedMotion()||!window.matchMedia('(hover: hover)').matches)return;
  const onMove=(e:PointerEvent)=>{
   const card=(e.target as Element|null)?.closest?.(GLOW) as HTMLElement|null;
   if(!card)return;
   const r=card.getBoundingClientRect();
   card.style.setProperty('--glow-x',`${e.clientX-r.left}px`);
   card.style.setProperty('--glow-y',`${e.clientY-r.top}px`);
  };
  document.addEventListener('pointermove',onMove,{passive:true});
  return()=>document.removeEventListener('pointermove',onMove);
 },[]);

 function jump(id:string){
  setMenuOpen(false);
  const el=document.getElementById(id);
  if(!el)return;
  el.scrollIntoView({behavior:reducedMotion()?'auto':'smooth',block:'start'});
  el.setAttribute('tabindex','-1');
  el.focus({preventScroll:true});
 }

 return <>
  <div className="scroll-progress" aria-hidden="true"><span style={{transform:`scaleX(${progress})`}}/></div>
  <div className="float-actions" ref={menuRef}>
   {sections.length>=3&&(scrolled||menuOpen)&&<div className="section-menu">
    {menuOpen&&<div className="section-menu-panel" role="menu" aria-label="Jump to a section">
     <div className="section-menu-title">On this page</div>
     {sections.map(s=><button key={s.id} type="button" role="menuitem" className={active===s.id?'is-active':undefined} onClick={()=>jump(s.id)}>{s.label}</button>)}
    </div>}
    <button type="button" className="float-button" aria-haspopup="menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(o=>!o)}>
     <NavIcon name="menu" size={16}/><span>Sections</span>
    </button>
   </div>}
   <button type="button" className={showTop?'float-button float-top is-visible':'float-button float-top'} aria-label="Back to top" tabIndex={showTop?0:-1} aria-hidden={!showTop}
    onClick={()=>{window.scrollTo({top:0,behavior:reducedMotion()?'auto':'smooth'});document.getElementById('main-content')?.focus({preventScroll:true});}}>
    <span className="float-top-arrow" aria-hidden="true"><NavIcon name="back" size={16}/></span>
   </button>
  </div>
 </>;
}
