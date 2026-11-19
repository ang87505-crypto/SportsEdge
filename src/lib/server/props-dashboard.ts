import 'server-only';
/** Read-only loader for the player-prop paper dashboard (last 14 days). */
import {propsStore,propsStoreConfig} from './props-store';
import {loadPropsDashboardFrom} from './props-dashboard-load';
import type {Raw} from '@/lib/props/dashboard-view';

export function propsDashboardConfigured(){
 // Synthetic Preview deployments never read a real ledger.
 if(process.env.SPORTSEDGE_PREVIEW_FIXTURES==='1')return false;
 try{propsStoreConfig();return true;}catch{return false;}
}

export async function loadPropsDashboard():Promise<Raw>{
 return loadPropsDashboardFrom(propsStore(),new Date().toISOString());
}
