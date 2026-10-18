"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {NavIcon} from '@/components/nav-icon';
import {CommandMenu} from '@/components/command-menu';
import {SECTIONS,PLATFORM,sectionFor,crumbsFor,parentFor} from '@/lib/navigation';

const isExact=(href:string,path:string)=>path===href;

function SidebarTree({path,onNavigate}:{path:string;onNavigate?:()=>void}){
 const current=sectionFor(path);
 return <>
  <div className="nav-group">
   {SECTIONS.map(section=>{
    const inSection=current?.id===section.id;
    return <div key={section.id} className={inSection?'nav-section is-active':'nav-section'}>
     <Link href={section.href} title={section.label} className="nav-link nav-link-section" aria-current={isExact(section.href,path)?'page':undefined} onClick={onNavigate}>
      <span className="nav-link-icon"><NavIcon name={section.icon} size={18}/></span>
      <span className="nav-link-label">{section.label}</span>
     </Link>
     {section.children.length>0&&<ul className="nav-children">
      {section.children.map(child=><li key={child.href}><Link href={child.href} className="nav-link nav-link-child" aria-current={path===child.href||path.startsWith(child.href+'/')?'page':undefined} onClick={onNavigate}>{child.label}</Link></li>)}
     </ul>}
    </div>;
   })}
  </div>
  <div className="nav-group">
   <div className="nav-group-label" id={onNavigate?'drawer-platform-label':'platform-label'}>Platform</div>
   <ul className="nav-flat" aria-labelledby={onNavigate?'drawer-platform-label':'platform-label'}>
    {PLATFORM.map(item=><li key={item.href}><Link href={item.href} title={item.label} className="nav-link" aria-current={isExact(item.href,path)?'page':undefined} onClick={onNavigate}>
     <span className="nav-link-icon"><NavIcon name={item.icon} size={18}/></span><span className="nav-link-label">{item.label}</span>
    </Link></li>)}
   </ul>
  </div>
 </>;
}

function ModeNote(){
 return <div className="mode-note">
  <div className="mode-note-title"><NavIcon name="shield" size={15}/> Paper and research only</div>
  <p>Bets and stock orders use virtual money. Nothing here can place a real-money wager or trade.</p>
  <Link href="/stocks/alpaca" className="mode-note-link"><NavIcon name="key" size={14}/> Owner sign-in</Link>
 </div>;
}

export default function WorkspaceShell({children}:{children:ReactNode}){
 const path=usePathname();
 const drawer=useRef<HTMLDialogElement>(null);
 const [drawerOpen,setDrawerOpen]=useState(false);
 const section=sectionFor(path);
 const crumbs=crumbsFor(path);
 const parent=parentFor(path);
 const inPlatform=PLATFORM.some(p=>path===p.href||path.startsWith(p.href+'/'));

 useEffect(()=>{if(drawer.current?.open)drawer.current.close();},[path]);
 function openDrawer(){drawer.current?.showModal();setDrawerOpen(true);}
 function closeDrawer(){drawer.current?.close();}

 return <div className="app">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <aside className="sidebar" aria-label="Sidebar">
   <Link href="/" className="brand" aria-label="SportsEdge overview">
    <span className="brand-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17 9.5 11l4 3.5L20 7"/><path d="M15 7h5v5"/></svg></span>
    <span className="brand-word">SportsEdge</span>
   </Link>
   <nav className="sidebar-nav" aria-label="Primary"><SidebarTree path={path}/></nav>
   <ModeNote/>
  </aside>

  <div className="app-body">
   <header className="topbar">
    <button type="button" className="icon-button topbar-menu" onClick={openDrawer} aria-label="Open navigation menu" aria-haspopup="dialog" aria-expanded={drawerOpen}><NavIcon name="menu" size={20}/></button>
    <Link href="/" className="topbar-brand" aria-label="SportsEdge overview"><span className="brand-mark" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17 9.5 11l4 3.5L20 7"/><path d="M15 7h5v5"/></svg></span>SportsEdge</Link>
    <nav className="breadcrumbs" aria-label="Breadcrumb">
     <ol>
      <li><Link href="/" aria-current={path==='/'?'page':undefined}>Overview</Link></li>
      {crumbs.map((c,i)=><li key={c.href}>{i===crumbs.length-1?<span aria-current="page">{c.label}</span>:<Link href={c.href}>{c.label}</Link>}</li>)}
     </ol>
    </nav>
    <div className="topbar-actions">
     <CommandMenu/>
     <span className="env-badge" title="Paper betting and Alpaca PAPER use virtual money only."><span className="env-badge-dot" aria-hidden="true"/>Paper only</span>
    </div>
   </header>

   <main id="main-content" className="content" tabIndex={-1}>
    {parent&&<Link href={parent.href} className="back-link"><NavIcon name="back" size={15}/>{parent.label}</Link>}
    {children}
   </main>

   <footer className="app-footer">
    <span>SportsEdge research platform. Paper betting and Alpaca PAPER only; no real-money execution.</span>
    <Link href="/guide#limits">Methodology and limitations</Link>
   </footer>
  </div>

  <nav className="tabbar" aria-label="Mobile navigation">
   {SECTIONS.map(s=>{
    const here=section?.id===s.id;
    return <Link key={s.id} href={s.href} aria-current={here?(isExact(s.href,path)?'page':'true'):undefined}>
     <NavIcon name={s.icon} size={20}/><span>{s.shortLabel}</span>
    </Link>;
   })}
   <button type="button" onClick={openDrawer} aria-current={inPlatform?'true':undefined} aria-haspopup="dialog" aria-expanded={drawerOpen}><NavIcon name="more" size={20}/><span>More</span></button>
  </nav>

  <dialog ref={drawer} className="drawer" aria-label="Navigation menu" onClose={()=>setDrawerOpen(false)} onClick={e=>{if(e.target===drawer.current)closeDrawer();}}>
   <div className="drawer-inner">
    <div className="drawer-head">
     <Link href="/" className="brand" onClick={closeDrawer}><span className="brand-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17 9.5 11l4 3.5L20 7"/><path d="M15 7h5v5"/></svg></span><span className="brand-word">SportsEdge</span></Link>
     <button type="button" className="icon-button" onClick={closeDrawer} aria-label="Close navigation menu"><NavIcon name="close" size={20}/></button>
    </div>
    <nav className="sidebar-nav" aria-label="All sections"><SidebarTree path={path} onNavigate={closeDrawer}/></nav>
    <ModeNote/>
   </div>
  </dialog>
 </div>;
}
