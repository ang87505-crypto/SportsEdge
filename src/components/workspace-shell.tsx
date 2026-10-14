"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import type {ReactNode} from 'react';
import {NavIcon,type NavIconName} from '@/components/nav-icon';
import {CommandMenu} from '@/components/command-menu';

type Destination={href:string;label:string;icon:NavIconName};
const workspaces:Destination[]=[
 {href:'/',label:'Overview',icon:'home'},
 {href:'/sports',label:'Sports',icon:'sports'},
 {href:'/stocks',label:'Stocks',icon:'stocks'},
 {href:'/paper-betting',label:'Paper bets',icon:'paper'},
];
const resources:Destination[]=[
 {href:'/research/nba',label:'Research',icon:'research'},
 {href:'/guide',label:'Guide',icon:'guide'},
];
const destinations=[...workspaces,...resources];
function active(href:string,path:string){
 if(href==='/')return path==='/';
 if(href==='/sports')return path.startsWith('/sports')||path.startsWith('/opportunities');
 if(href==='/research/nba')return path.startsWith('/research');
 return path===href||path.startsWith(href+'/');
}
function MenuLinks({items,path}:{items:Destination[];path:string}){
 return <>{items.map(item=><Link key={item.href} href={item.href} aria-current={active(item.href,path)?'page':undefined}><span className="nav-icon"><NavIcon name={item.icon}/></span><span>{item.label}</span></Link>)}</>;
}
export default function WorkspaceShell({children}:{children:ReactNode}){
 const path=usePathname();
 const match=destinations.find(item=>active(item.href,path));
 const section=match?.label??'Research';
 const detail=path.startsWith('/stocks/research')?'Stock research':path.startsWith('/stocks/alpaca')?'Alpaca paper account':path.startsWith('/research/nba')?'NBA analysis':path.startsWith('/research/epl')?'EPL analysis':path.startsWith('/opportunities')?'Game analysis':null;
 const back=path.startsWith('/stocks/')?'/stocks':path.startsWith('/research')||path.startsWith('/opportunities')?'/sports':'/';
 return <div className="workspace">
  <a className="skip-link" href="#main-content">Skip to content</a>
  <aside className="sidebar" aria-label="Workspace sidebar">
   <Link href="/" className="brand" aria-label="SportsEdge overview"><span className="brand-mark"><NavIcon name="stocks" size={20}/></span><span>sports<strong>edge</strong></span></Link>
   <div className="sidebar-identity">RESEARCH TERMINAL <span>01</span></div>
   <div className="sidebar-section">
    <div className="sidebar-group-label">WORKSPACES</div>
    <nav aria-label="Workspaces"><MenuLinks items={workspaces} path={path}/></nav>
   </div>
   <div className="sidebar-section">
    <div className="sidebar-group-label">INSIGHTS & TOOLS</div>
    <nav aria-label="Research and tools"><MenuLinks items={resources} path={path}/></nav>
   </div>
   <div className="sidebar-note">
    <div className="sidebar-mode"><NavIcon name="shield" size={16}/> SIMULATION MODE</div>
    <p>Research and virtual practice only. No real-money orders.</p>
    <Link href="/paper-betting" className="sidebar-note-link">Review paper results <NavIcon name="arrow" size={15}/></Link>
   </div>
  </aside>
  <div className="workspace-body">
   <header className="topbar">
    <div className="topbar-context"><span className="topbar-kicker">SPORTSEDGE / WORKSPACE</span><div className="breadcrumbs"><Link href="/">Overview</Link>{path!=='/'&&<><span className="crumb-divider">/</span><span aria-current="page">{section}</span>{detail&&<><span className="crumb-divider">/</span><span>{detail}</span></>}</>}</div></div>
    <div className="top-actions"><CommandMenu/><span className="environment-label"><span className="status-dot"/> SIMULATION ONLY</span><Link href="/guide" className="help-link"><NavIcon name="guide" size={16}/> Help center</Link></div>
   </header>
   <nav className="mobile-nav" aria-label="Mobile navigation"><MenuLinks items={destinations} path={path}/></nav>
   <main id="main-content" className="workspace-content">
    {path!=='/'&&<div className="return-row"><Link href={back}>← {back==='/sports'?'Sports workspace':back==='/stocks'?'Stock workspace':'Overview'}</Link>{back!=='/'&&<Link href="/">Overview</Link>}</div>}
    {children}
   </main>
   <footer className="workspace-footer"><span>SPORTSEDGE <span aria-hidden="true">/</span> Research and simulation platform</span><Link href="/guide#limits">Methodology & limitations ↗</Link></footer>
  </div>
 </div>;
}
