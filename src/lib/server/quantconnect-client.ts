/**
 * Restricted QuantConnect v2 API client.
 * Explicit read-only endpoint allowlist. No market-data exports, no cloud jobs,
 * no code writes, no order placement. Only import from server-side routes.
 */
import {createHash} from 'node:crypto';

const API_ROOT = 'https://www.quantconnect.com/api/v2';
export type QcConfig = {userId:string; apiToken:string; projectId:number};
export type QcBacktestSummary = {
  backtestId:string; name:string; status:string; created:string;
};
export type QcListing = {
  source:'QuantConnect';
  projectId:number;
  backtests:QcBacktestSummary[];
  returnedCount:number;
  historicalPerformanceVerified:false;
  paperTradingEnabled:false;
};
type HttpFetch = typeof fetch;

function record(x:unknown): x is Record<string,unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}
export function requireQcConfig(config:QcConfig) {
  if(!/^\d{1,18}$/.test(config.userId) || !config.apiToken || config.apiToken.length < 12 ||
     !Number.isSafeInteger(config.projectId) || config.projectId <= 0) {
    throw new Error('QuantConnect credentials or project ID not configured');
  }
}
export function qcSignedHeaders(userId:string,apiToken:string,atSeconds:number): Record<string,string> {
  if(!/^\d{1,18}$/.test(userId) || apiToken.length < 12 ||
     !Number.isSafeInteger(atSeconds) || atSeconds <= 0) {
    throw new Error('Invalid QuantConnect signing inputs');
  }
  const timestamp=String(atSeconds);
  const digest=createHash('sha256').update(apiToken+':'+timestamp,'utf8').digest('hex');
  const encoded=Buffer.from(userId+':'+digest,'utf8').toString('base64');
  return {Authorization:'Basic '+encoded,Timestamp:timestamp,'Content-Type':'application/json',Accept:'application/json'};
}
export function parseQcListing(payload:unknown, projectId:number):QcListing {
  if(!record(payload) || payload.success !== true || !Array.isArray(payload.backtests)) {
    throw new Error('Unexpected QuantConnect backtest response');
  }
  if(payload.backtests.length > 10000) throw new Error('QuantConnect listing is unexpectedly large');
  const sorted=payload.backtests.map((entry:unknown) => {
    if(!record(entry) || typeof entry.backtestId !== 'string' ||
       !/^[a-zA-Z0-9_-]{8,80}$/.test(entry.backtestId) ||
       typeof entry.name !== 'string' || typeof entry.status !== 'string' ||
       typeof entry.created !== 'string' || !Number.isFinite(Date.parse(entry.created))) {
      throw new Error('Invalid QuantConnect backtest metadata');
    }
    return {backtestId:entry.backtestId,name:entry.name.slice(0,120),
            status:entry.status.slice(0,60),created:entry.created};
  });
  sorted.sort((a,b)=>b.created.localeCompare(a.created)||a.backtestId.localeCompare(b.backtestId));
  return {source:'QuantConnect',projectId,
    backtests:sorted.slice(0,25),returnedCount:sorted.length,
    historicalPerformanceVerified:false,paperTradingEnabled:false};
}
async function callQc(endpoint:'authenticate'|'backtests/list',body:Record<string,unknown>,config:QcConfig,fetcher:HttpFetch) {
  requireQcConfig(config);
  const response=await fetcher(API_ROOT+'/'+endpoint,{
    method:'POST', headers:qcSignedHeaders(config.userId,config.apiToken,Math.floor(Date.now()/1000)),
    body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)
  });
  if(!response.ok) throw new Error('QuantConnect API unavailable or authorization denied');
  const raw=await response.text();
  if(raw.length>2_000_000) throw new Error('Unexpectedly large QuantConnect response');
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw new Error('Invalid QuantConnect API JSON');}
  if(!record(parsed) || parsed.success !== true) throw new Error('QuantConnect API rejected the request');
  return parsed;
}
export async function verifyQuantConnect(config:QcConfig,fetcher:HttpFetch=fetch) {
  await callQc('authenticate',{},config,fetcher);
  return {status:'authenticated' as const,source:'QuantConnect' as const,
    projectId:config.projectId,historicalPerformanceVerified:false};
}
export async function listQuantConnect(config:QcConfig,fetcher:HttpFetch=fetch) {
  const raw=await callQc('backtests/list',{projectId:config.projectId,includeStatistics:false},config,fetcher);
  return parseQcListing(raw,config.projectId);
}
