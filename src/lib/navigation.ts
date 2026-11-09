import type {NavIconName} from '@/components/nav-icon';

/*
 * Single source of truth for the information architecture.
 * Three primary sections (Sports AI, PrizePicks paper picks, Stocks) plus Overview,
 * and a small platform group. Every href here must be a real route.
 */
export type NavLeaf={href:string;label:string;description:string};
export type NavSection={id:'overview'|'sports'|'paper'|'stocks';href:string;label:string;shortLabel:string;icon:NavIconName;description:string;children:NavLeaf[];match:string[]};

export const SECTIONS:NavSection[]=[
 {id:'overview',href:'/',label:'Overview',shortLabel:'Home',icon:'home',description:'Command center: status, activity and alerts',children:[],match:[]},
 {id:'sports',href:'/sports',label:'Sports AI',shortLabel:'Sports',icon:'sports',description:'Games, model probabilities and recorded odds',
  match:['/sports','/research/nba','/research/epl','/research/backtest','/opportunities'],
  children:[
   {href:'/research/nba',label:'NBA model',description:'Forecasts, calibration and accuracy'},
   {href:'/research/epl',label:'Soccer model',description:'EPL three-way forecast archive'},
   {href:'/research/backtest',label:'Soccer accuracy history',description:'Six-month retrospective by league'},
  ]},
 {id:'paper',href:'/paper-betting/props',label:'PrizePicks',shortLabel:'Picks',icon:'paper',description:'Daily virtual player-prop picks, results and controls',match:['/paper-betting','/assistant'],
  children:[
   {href:'/assistant',label:'Ask',description:'Ask about picks, results and the model'},
   {href:'/paper-betting/props-research',label:'Ranked picks & research',description:'Top qualifying picks and the model comparison'},
   {href:'/paper-betting',label:'Moneyline ledger (older test)',description:'The earlier NBA moneyline virtual bankroll'},
  ]},
 {id:'stocks',href:'/stocks',label:'Stocks',shortLabel:'Stocks',icon:'stocks',description:'Paper portfolio, research and automation status',
  match:['/stocks'],
  children:[
   {href:'/stocks/paper-auto',label:'Autopilot',description:'Start, stop and follow the weekly stock autopilot'},
   {href:'/stocks/alpaca',label:'Paper account & orders',description:'Alpaca PAPER owner dashboard'},
   {href:'/stocks/research',label:'Quant research',description:'Frozen strategy, evidence gates and costs'},
   {href:'/stocks/journal',label:'Practice journal',description:'Manual virtual trades in this browser'},
  ]},
];

export const PLATFORM:(NavLeaf&{icon:NavIconName})[]=[
 {href:'/automation',label:'Paper automation',description:'Sports and stocks: status, next steps and results',icon:'pulse'},
 {href:'/progress',label:'Research status',description:'Evidence gates and milestones',icon:'pulse'},
 {href:'/testing',label:'Test center',description:'Owner acceptance walkthrough',icon:'shield'},
 {href:'/guide',label:'Guide & methodology',description:'Terms, data sources and limits',icon:'book'},
];

export function sectionFor(path:string):NavSection|null{
 if(path==='/')return SECTIONS[0];
 return SECTIONS.find(s=>s.match.some(m=>path===m||path.startsWith(m+'/')))??null;
}

export type Crumb={href:string;label:string};
/**
 * The child page the path belongs to: the longest matching child, never one when the path is
 * the section's own landing page (a child such as /paper-betting can be a prefix of it).
 */
export function activeChild(section:NavSection,path:string):NavLeaf|null{
 const under=(href:string)=>path===href||path.startsWith(href+'/');
 const child=section.children.filter(c=>under(c.href)).sort((a,b)=>b.href.length-a.href.length)[0]??null;
 if(!child)return null;
 // The landing page wins when it is the more specific match (/paper-betting/props over /paper-betting).
 return under(section.href)&&section.href.length>child.href.length?null:child;
}
export function crumbsFor(path:string):Crumb[]{
 const section=sectionFor(path);
 if(section&&section.id!=='overview'){
  const crumbs:Crumb[]=[{href:section.href,label:section.label}];
  const leaf=activeChild(section,path);
  if(leaf)crumbs.push({href:leaf.href,label:leaf.label});
  return crumbs;
 }
 const platform=PLATFORM.find(p=>path===p.href||path.startsWith(p.href+'/'));
 if(platform)return [{href:platform.href,label:platform.label}];
 return [];
}

/** Where the in-page back link leads: the parent of a nested page, otherwise nothing. */
export function parentFor(path:string):Crumb|null{
 const crumbs=crumbsFor(path);
 return crumbs.length>1?crumbs[crumbs.length-2]:null;
}
