'use client';
import {useSyncExternalStore} from 'react';

const subscribe=()=>()=>{};
const minute=()=>Math.floor(Date.now()/60000)*60000;
/** Current time rounded to the minute on the client; 0 during server render so relative ages never hydrate mismatched. */
export function useNow(){return useSyncExternalStore(subscribe,minute,()=>0);}
