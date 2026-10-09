import Link from 'next/link';
import type {ReactNode} from 'react';
export function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}){return <header className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</header>;}
export function Stat({label,value,detail}:{label:string;value:ReactNode;detail:string}){return <div className="glass stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;}
export function Empty({title,children}:{title:string;children:ReactNode}){return <div className="empty-state"><span className="empty-symbol">↗</span><h3>{title}</h3><p>{children}</p></div>;}
export function Details({title,children}:{title:string;children:ReactNode}){return <details className="glass detail-panel"><summary>{title}<span aria-hidden="true">＋</span></summary><div className="detail-content">{children}</div></details>;}
export function Action({href,children,secondary=false}:{href:string;children:ReactNode;secondary?:boolean}){return <Link className={secondary?'button button-secondary':'button'} href={href}>{children}<span aria-hidden="true">↗</span></Link>;}
