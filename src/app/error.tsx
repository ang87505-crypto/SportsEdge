'use client';

import Link from 'next/link';
import {useEffect} from 'react';
import {Panel} from '@/components/ui';

export default function Error({error,retry}:{error:Error&{digest?:string};retry:()=>void}){
 useEffect(()=>{console.error(error);},[error]);
 return <div className="status-page">
  <Panel>
   <div className="status-page-body">
    <span className="status-page-code tone-text-negative">Something went wrong</span>
    <h1>This page could not be shown</h1>
    <p>An unexpected error stopped the page from rendering. No data was changed and no order or bet was placed. Try again, or go back to the overview.</p>
    {error.digest&&<p className="quiet">Reference: <code>{error.digest}</code></p>}
    <div className="button-row"><button type="button" className="button" onClick={()=>retry()}>Try again</button><Link href="/" className="button button-secondary">Go to overview</Link></div>
   </div>
  </Panel>
 </div>;
}
