import type {NavIconName} from '@/components/nav-icon';

/*
 * Single source of truth for the information architecture.
 * Three primary sections (Sports AI, Paper Betting, Stocks) plus Overview,
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
 {id:'paper',href:'/paper-betting',label:'Paper Betting',shortLabel:'Bets',icon:'paper',description:'Virtual-money NBA ledger and performance',match:['/paper-betting'],children:[]},
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
 {href:'/progress',label:'Research status',description:'Evidence gates and milestones',icon:'pulse'},
 {href:'/testing',label:'Test center',description:'Owner acceptance walkthrough',icon:'shield'},
 {href:'/guide',label:'Guide & methodology',description:'Terms, data sources and limits',icon:'book'},
];

export function sectionFor(path:string):NavSection|null{
 if(path==='/')return SECTIONS[0];
 return SECTIONS.find(s=>s.match.some(m=>path===m||path.startsWith(m+'/')))??null;
}

export type Crumb={href:string;label:string};
export function crumbsFor(path:string):Crumb[]{
 const section=sectionFor(path);
 if(section&&section.id!=='overview'){
  const crumbs:Crumb[]=[{href:section.href,label:section.label}];
  const leaf=section.children.find(c=>path===c.href||path.startsWith(c.href+'/'));
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
