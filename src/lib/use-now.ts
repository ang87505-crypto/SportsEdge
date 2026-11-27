'use client';
import {useSyncExternalStore} from 'react';

const subscribe=(changed:()=>void)=>{
 const timer=window.setInterval(changed,60_000);
 window.addEventListener('focus',changed);
 return()=>{window.clearInterval(timer);window.removeEventListener('focus',changed);};
};
const minute=()=>Math.floor(Date.now()/60000)*60000;
/** Tick display ages while open and on return; 0 on the server avoids a hydration mismatch. No data requests. */
export function useNow(){return useSyncExternalStore(subscribe,minute,()=>0);}
