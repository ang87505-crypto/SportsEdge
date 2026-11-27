import 'server-only';
/** One briefing per request for the Overview: props ledger, operations monitor and research summary, each failing on its own. */
import {cache} from 'react';
import {loadPropsDashboard,propsDashboardConfigured} from './props-dashboard';
import {loadOpsStatus} from './ops-status-load';
import {loadStockResearch} from './stock-research-load';
import {loadResearchEngine} from './research-engine-load';
import {buildBriefing,propsInput,type Briefing} from '@/lib/briefing/briefing';

export const loadBriefing=cache(async():Promise<Briefing>=>{
 const nowIso=new Date().toISOString();
 const [raw,ops,research,engine]=await Promise.allSettled([propsDashboardConfigured()?loadPropsDashboard():Promise.resolve(null),
  loadOpsStatus(nowIso),loadStockResearch(nowIso),loadResearchEngine(nowIso)]);
 return buildBriefing({nowIso,props:propsInput(raw.status==='fulfilled'?raw.value:null),
  ops:ops.status==='fulfilled'?ops.value:null,research:research.status==='fulfilled'?research.value:null,
  engine:engine.status==='fulfilled'?engine.value:null});
});
