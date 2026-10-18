'use client';
import {useEffect,useState} from 'react';

/** Owner-only, read-only Alpaca PAPER snapshot returned by /api/internal/alpaca-paper/view. */
export type PaperSnapshot={
  state:'READ_ONLY_DIAGNOSTIC_NOT_EXECUTION_AUTHORIZATION';
  readOnly:true;
  automaticPaperOrdersEnabled:false;
  accountType:'paper';
  capturedAt:string;
  account:{
    status:string;
    cashUsd:string;
    equityUsd:string;
    portfolioValueUsd:string;
    buyingPowerUsd:string;
    tradingBlocked:boolean;
    accountBlocked:boolean;
  };
  positions:Array<{symbol:string;side:'long'|'short';qty:string;marketValueUsd:string}>;
  recentOrders:Array<{id:string;symbol:string;side:string;status:string;createdAt:string}>;
  warnings:string[];
};
export function isPaperSnapshot(data:unknown):data is PaperSnapshot {
  if(!data||typeof data!=='object')return false;
  const x=data as Record<string,unknown>;
  return x.accountType==='paper'&&x.readOnly===true&&
    x.automaticPaperOrdersEnabled===false&&
    x.state==='READ_ONLY_DIAGNOSTIC_NOT_EXECUTION_AUTHORIZATION'&&
    !!x.account&&typeof x.account==='object'&&Array.isArray(x.positions)&&
    Array.isArray(x.recentOrders)&&Array.isArray(x.warnings);
}

export type PaperView={status:'checking'}|{status:'login'}|{status:'unconfigured'}|{status:'error'}|{status:'ready';snapshot:PaperSnapshot};

/** Read-only summary for the Stocks dashboard. It never signs in, never writes and never stores the owner key. */
export function usePaperSnapshotSummary(){
  const [view,setView]=useState<PaperView>({status:'checking'});
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/internal/alpaca-paper/view',{method:'GET',cache:'no-store',credentials:'same-origin',signal:controller.signal})
      .then(async response=>{
        const data:unknown=await response.json().catch(()=>null);
        const state=data&&typeof data==='object'&&'status' in data?(data as {status?:unknown}).status:undefined;
        if(controller.signal.aborted)return;
        if(response.status===401&&state==='owner_access_required')setView({status:'login'});
        else if(response.status===503&&state==='owner_access_not_configured')setView({status:'unconfigured'});
        else if(response.ok&&isPaperSnapshot(data))setView({status:'ready',snapshot:data});
        else setView({status:'error'});
      })
      .catch(()=>{if(!controller.signal.aborted)setView({status:'error'});});
    return()=>controller.abort();
  },[]);
  return view;
}
