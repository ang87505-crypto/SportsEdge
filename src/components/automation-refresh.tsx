'use client';
import {useEffect,useTransition} from 'react';
import {useRouter} from 'next/navigation';

/** Refreshes records only, while the page is visible. Never starts a worker. */
export function AutomationRefresh(){
 const router=useRouter();
 const [pending,startTransition]=useTransition();
 useEffect(()=>{
  const refresh=()=>{if(document.visibilityState==='visible')router.refresh();};
  const timer=window.setInterval(refresh,60_000);
  document.addEventListener('visibilitychange',refresh);
  return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[router]);
 return <button type="button" className="button button-secondary" disabled={pending}
  onClick={()=>startTransition(()=>router.refresh())}>{pending?'Refreshing…':'Refresh status'}</button>;
}
