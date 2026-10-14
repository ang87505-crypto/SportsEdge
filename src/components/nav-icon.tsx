import type {ReactNode} from 'react';

export type NavIconName='home'|'sports'|'stocks'|'paper'|'research'|'guide'|'connections'|'arrow'|'shield'|'search'|'spark';

export function NavIcon({name,size=19}:{name:NavIconName;size?:number}){
 let drawing:ReactNode;
 switch(name){
  case 'home':drawing=<><path d="m3.5 10 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9M10 20v-6h4v6"/></>;break;
  case 'sports':drawing=<><circle cx="12" cy="12" r="9"/><path d="m7 5 2 5-3 4m11 5-3-5 3-4M3 12h18"/><path d="m9 10 6 4"/></>;break;
  case 'stocks':drawing=<><path d="M4 19V5m0 14h16M7 15l5-5 3 2 5-7"/><path d="M16 5h4v4"/></>;break;
  case 'paper':drawing=<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>;break;
  case 'research':drawing=<><path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-5-5h-2"/><path d="M14 3v6h6M8 14h8M8 17h5"/></>;break;
  case 'connections':drawing=<><rect x="2.5" y="8" width="6" height="8" rx="1.5"/><rect x="15.5" y="8" width="6" height="8" rx="1.5"/><path d="M8.5 12h7M5.5 5v3M5.5 16v3M18.5 5v3M18.5 16v3"/></>;break;
  case 'guide':drawing=<><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.7 2.7 0 1 1 4.4 2.1c-1.1.9-1.9 1.4-1.9 3"/><path d="M12 17.5h.01"/></>;break;
  case 'arrow':drawing=<><path d="M5 12h14m-6-6 6 6-6 6"/></>;break;
  case 'search':drawing=<><circle cx="10.8" cy="10.8" r="7.1"/><path d="m16 16 5 5"/></>;break;
  case 'spark':drawing=<><path d="m12 2 1.8 7 7.2 3-7.2 2.9L12 22l-1.8-7.1L3 12l7.2-3L12 2Z"/></>;break;
  case 'shield':drawing=<><path d="M12 2.5 20 6v6c0 5-3.5 8-8 9.5C7.5 20 4 17 4 12V6l8-3.5Z"/><path d="m9 12 2 2 4-4"/></>;break;
 }
 return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{drawing}</svg>;
}
