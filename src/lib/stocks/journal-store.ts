'use client';
import {useMemo,useSyncExternalStore} from 'react';
import {EMPTY,parseJournal,type Journal} from '@/lib/stocks/journal';

/** Browser-local manual practice journal. Same storage key and events as before the redesign. */
export const JOURNAL_KEY='sportsedge-stock-journal-v1';
const FALLBACK=JSON.stringify(EMPTY);
function subscribe(cb:()=>void){window.addEventListener('storage',cb);window.addEventListener('stock-journal',cb);return()=>{window.removeEventListener('storage',cb);window.removeEventListener('stock-journal',cb);};}
export function journalSnapshot(){try{return localStorage.getItem(JOURNAL_KEY)??FALLBACK;}catch{return FALLBACK;}}
export function useJournal(){
 const raw=useSyncExternalStore(subscribe,journalSnapshot,()=>FALLBACK);
 const parsed=useMemo(()=>{try{return {journal:parseJournal(raw),invalid:false};}catch{return {journal:EMPTY,invalid:true};}},[raw]);
 return {raw,...parsed};
}
export function writeJournal(next:Journal){localStorage.setItem(JOURNAL_KEY,JSON.stringify(next));window.dispatchEvent(new Event('stock-journal'));}
