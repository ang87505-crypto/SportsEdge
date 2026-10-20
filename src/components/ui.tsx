import Link from 'next/link';
import type {ReactNode} from 'react';

/*
 * SportsEdge component library. Server-safe (no hooks) so pages and client
 * components can share it. Legacy exports (PageHeading, Stat, Empty, Details,
 * Action) keep their original props so concurrent branches render unchanged.
 */

export type Tone='positive'|'negative'|'warning'|'neutral'|'info'|'accent';

const cx=(...names:(string|false|null|undefined)[])=>names.filter(Boolean).join(' ');

/** Page title block. `eyebrow` is accepted for compatibility; location is shown by the breadcrumb instead. */
export function PageHeading({title,description,action,meta}:{eyebrow?:string;title:string;description?:ReactNode;action?:ReactNode;meta?:ReactNode}){
 return <header className="page-heading">
  <div className="page-heading-copy">
   <h1>{title}</h1>
   {description&&<p>{description}</p>}
   {meta&&<div className="page-heading-meta">{meta}</div>}
  </div>
  {action&&<div className="page-heading-actions">{action}</div>}
 </header>;
}

export function SectionHeader({title,description,actions,id,level=2}:{title:ReactNode;description?:ReactNode;actions?:ReactNode;id?:string;level?:2|3}){
 const Heading=level===2?'h2':'h3';
 return <div className="section-header">
  <div><Heading id={id}>{title}</Heading>{description&&<p>{description}</p>}</div>
  {actions&&<div className="section-header-actions">{actions}</div>}
 </div>;
}

export function Panel({title,description,actions,children,className,id,labelledBy,flush=false,as='section'}:
 {title?:ReactNode;description?:ReactNode;actions?:ReactNode;children?:ReactNode;className?:string;id?:string;labelledBy?:string;flush?:boolean;as?:'section'|'div'|'article'}){
 const Tag=as;
 const headingId=labelledBy??(id&&title?id+'-title':undefined);
 return <Tag className={cx('panel-v2',flush&&'is-flush',className)} id={id} aria-labelledby={title?headingId:undefined}>
  {(title||actions)&&<div className="panel-head">
   <div className="panel-head-copy">{title&&<h2 id={headingId}>{title}</h2>}{description&&<p>{description}</p>}</div>
   {actions&&<div className="panel-head-actions">{actions}</div>}
  </div>}
  {children}
 </Tag>;
}

export function Badge({tone='neutral',children,dot=false,title}:{tone?:Tone;children:ReactNode;dot?:boolean;title?:string}){
 return <span className={cx('badge',`tone-${tone}`)} title={title}>{dot&&<span className="badge-dot" aria-hidden="true"/>}{children}</span>;
}

export function StatusDot({tone='neutral',label}:{tone?:Tone;label?:string}){
 return <span className={cx('status-dot-v2',`tone-${tone}`)} role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:true}/>;
}

/*
 * Evidence labels make provenance explicit on every figure. Each kind has a
 * distinct glyph so identity never depends on colour alone.
 */
export type EvidenceKind='verified'|'recorded'|'broker'|'simulated'|'synthetic'|'unverified'|'not-measured'|'unavailable'|'local'|'historical';
const EVIDENCE:Record<EvidenceKind,{label:string;tone:Tone;glyph:string;hint:string}>={
 verified:{label:'Verified',tone:'positive',glyph:'✓',hint:'Measured from audited, reconciled records.'},
 historical:{label:'Historical study',tone:'info',glyph:'◷',hint:'Retrospective evaluation on past games. Not a betting or trading return.'},
 recorded:{label:'Recorded',tone:'neutral',glyph:'●',hint:'Read from saved SportsEdge records. Not a live feed.'},
 broker:{label:'Broker-reported',tone:'info',glyph:'◆',hint:'Reported by Alpaca PAPER. Simulated fills, not real money.'},
 simulated:{label:'Simulated',tone:'neutral',glyph:'◇',hint:'Virtual money. No real wager or order exists.'},
 synthetic:{label:'Synthetic test',tone:'warning',glyph:'△',hint:'Engineering fixture. Never a performance result.'},
 unverified:{label:'Unverified',tone:'warning',glyph:'?',hint:'Research claim that has not passed its evidence gates.'},
 'not-measured':{label:'Not measured',tone:'neutral',glyph:'○',hint:'No valid measurement exists yet. Nothing is assumed.'},
 unavailable:{label:'Unavailable',tone:'negative',glyph:'!',hint:'The source could not be reached or validated.'},
 local:{label:'This browser',tone:'neutral',glyph:'□',hint:'Saved only in this browser. Not synced or verified.'},
};
export function Evidence({kind,label}:{kind:EvidenceKind;label?:string}){
 const e=EVIDENCE[kind];
 return <span className={cx('evidence',`tone-${e.tone}`)} title={e.hint}><span className="evidence-glyph" aria-hidden="true">{e.glyph}</span>{label??e.label}</span>;
}

export function Metric({label,value,detail,tone,evidence,size='md',hint}:
 {label:ReactNode;value:ReactNode;detail?:ReactNode;tone?:Tone;evidence?:EvidenceKind;size?:'md'|'lg'|'sm';hint?:string}){
 return <div className={cx('metric',`metric-${size}`)}>
  <div className="metric-top"><span className="metric-label">{label}{hint&&<span className="metric-hint" tabIndex={0} role="note" aria-label={hint} data-tip={hint}>i</span>}</span>{evidence&&<Evidence kind={evidence}/>}</div>
  <strong className={cx('metric-value',tone&&`tone-text-${tone}`)}>{value}</strong>
  {detail&&<span className="metric-detail">{detail}</span>}
 </div>;
}

export function MetricGrid({children,columns=4,className}:{children:ReactNode;columns?:2|3|4|5;className?:string}){
 return <div className={cx('metric-grid',`cols-${columns}`,className)}>{children}</div>;
}

/** Legacy KPI tile, now rendered with the Metric styling. */
export function Stat({label,value,detail}:{label:string;value:ReactNode;detail:string}){
 return <div className="glass stat"><Metric label={label} value={value} detail={detail}/></div>;
}

export function Empty({title,children,action}:{title:string;children:ReactNode;action?:ReactNode}){
 return <div className="empty-state">
  <span className="empty-symbol" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 12h8"/></svg></span>
  <h3>{title}</h3><p>{children}</p>{action&&<div className="empty-action">{action}</div>}
 </div>;
}

export function Callout({tone='neutral',title,children,role}:{tone?:Tone;title?:ReactNode;children?:ReactNode;role?:'status'|'alert'}){
 return <div className={cx('callout',`tone-${tone}`)} role={role}>
  <span className="callout-bar" aria-hidden="true"/>
  <div>{title&&<strong className="callout-title">{title}</strong>}{children&&<div className="callout-body">{children}</div>}</div>
 </div>;
}

export function Skeleton({lines=3,height}:{lines?:number;height?:number}){
 if(height)return <div className="skeleton skeleton-block" style={{height}} aria-hidden="true"/>;
 return <div className="skeleton-lines" aria-hidden="true">{Array.from({length:lines},(_,i)=><span key={i} className="skeleton" style={{width:`${92-i*14}%`}}/>)}</div>;
}

export function Loading({label}:{label:string}){
 return <div className="loading-panel" role="status" aria-live="polite"><Skeleton lines={3}/><span className="sr-only">{label}</span><span className="loading-label">{label}</span></div>;
}

export function KeyValues({items}:{items:[ReactNode,ReactNode][]}){
 return <dl className="kv">{items.map(([k,v],i)=><div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Details({title,children,defaultOpen=false}:{title:string;children:ReactNode;defaultOpen?:boolean}){
 return <details className="glass detail-panel" open={defaultOpen}><summary>{title}<span className="detail-chevron" aria-hidden="true"/></summary><div className="detail-content">{children}</div></details>;
}

export function Action({href,children,secondary=false}:{href:string;children:ReactNode;secondary?:boolean}){
 return <Link className={secondary?'button button-secondary':'button'} href={href}>{children}</Link>;
}

export function TextLink({href,children,external=false}:{href:string;children:ReactNode;external?:boolean}){
 if(external)return <a className="text-link" href={href} target="_blank" rel="noopener noreferrer">{children}<span className="sr-only"> (opens in a new tab)</span></a>;
 return <Link className="text-link" href={href}>{children}</Link>;
}

export function Segmented<T extends string>({options,value,onChange,label}:{options:{value:T;label:ReactNode;count?:number}[];value:T;onChange:(v:T)=>void;label:string}){
 return <div className="segmented" role="group" aria-label={label}>
  {options.map(o=><button key={o.value} type="button" aria-pressed={value===o.value} onClick={()=>onChange(o.value)}>{o.label}{o.count!==undefined&&<span className="segmented-count">{o.count}</span>}</button>)}
 </div>;
}

/** Visual separation of the five automation operator states defined by the recurring PAPER controller. */
export const OPERATOR_STATE_ORDER=['STOPPED','PAUSED','READY','BLOCKED','EXECUTING'] as const;
export function OperatorStates({current,note}:{current:string|null;note:string}){
 const tone:Record<string,Tone>={STOPPED:'negative',PAUSED:'warning',READY:'positive',BLOCKED:'warning',EXECUTING:'info'};
 return <div className="operator-states">
  <ol aria-label="Automation operator states">{OPERATOR_STATE_ORDER.map(s=><li key={s} className={cx(`tone-${tone[s]}`,current===s&&'is-current')} aria-current={current===s?'true':undefined}>{s}</li>)}</ol>
  <p>{note}</p>
 </div>;
}
