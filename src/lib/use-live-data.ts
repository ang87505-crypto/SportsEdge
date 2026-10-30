'use client';
import {useCallback,useEffect,useState} from 'react';
import {isResearchSnapshot,snapshotDetails,parseSportsFeed,type ResearchSnapshot,type SnapshotDetails,type SportsFeed} from '@/lib/dashboard-snapshot';

export type LoadState<T>={status:'loading'}|{status:'error'}|{status:'ready';data:T;checkedAt:number};

/** Fetch JSON and validate it. A failed or unverifiable response is an error state, never a default value. */
function useValidated<T>(url:string,validate:(v:unknown)=>T|null){
 const [attempt,setAttempt]=useState(0);
 const [state,setState]=useState<LoadState<T>>({status:'loading'});
 useEffect(()=>{
  const controller=new AbortController();
  fetch(url,{signal:controller.signal,cache:'no-store'})
   .then(async r=>{if(!r.ok)throw Error('unavailable');const value=validate(await r.json());if(value===null)throw Error('invalid');return value;})
   .then(data=>{if(!controller.signal.aborted)setState({status:'ready',data,checkedAt:Date.now()});})
   .catch(()=>{if(!controller.signal.aborted)setState({status:'error'});});
  return()=>controller.abort();
 },[url,attempt,validate]);
 const retry=useCallback(()=>{setState({status:'loading'});setAttempt(a=>a+1);},[]);
 return [state,retry] as const;
}

export type Research={snapshot:ResearchSnapshot;details:SnapshotDetails};
const validateResearch=(v:unknown):Research|null=>isResearchSnapshot(v)?{snapshot:v,details:snapshotDetails(v)}:null;
export function useResearch(){return useValidated('/api/research',validateResearch);}

export function useSportsFeed(sport:'nba'|'soccer'){return useValidated<SportsFeed>(`/api/sports?sport=${sport}`,parseSportsFeed);}
