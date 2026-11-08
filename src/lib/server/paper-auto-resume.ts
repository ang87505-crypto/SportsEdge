/** Bind a Start to the gate version the owner saw, so a later Stop always wins. */
import {runReconcileSlot,type ControllerDeps} from './paper-auto-controller.ts';
import {PaperAutoStoreError} from './paper-auto-store.ts';
import {quarterHourSlot} from './paper-auto-time.ts';

export async function resumeAfterOwnerCheck(deps:ControllerDeps,experimentId:string,ownerRef:string,
 expectedGateVersion?:number,reconcile=runReconcileSlot){
 const before=await deps.store.call('status',{experiment_id:experimentId});
 const version=expectedGateVersion??before.gateVersion;
 if(!Number.isSafeInteger(version)||(version as number)<1||version!==before.gateVersion)
  throw new PaperAutoStoreError('PAPER_AUTO_RESUME_STALE_VERSION',true);
 if(typeof before.unacknowledgedCriticalAlerts==='number'&&before.unacknowledgedCriticalAlerts>0)
  throw new PaperAutoStoreError('PAPER_AUTO_RESUME_CRITICAL_ALERT_OPEN',true);
 const rec=await reconcile(deps,experimentId,quarterHourSlot(deps.now()));
 if(rec.reason!=='CLEAN'||!rec.runId)return {status:'RECONCILE_NOT_CLEAN' as const,outcome:rec.outcome,reason:rec.reason};
 // Do not re-read and adopt a newer gate version after reconciling. A Stop or Pause
 // during this check must invalidate this Start, even if the account check is clean.
 const after=await deps.store.call('resume',{experiment_id:experimentId,owner_ref:ownerRef,
  expected_gate_version:version,reconcile_run_id:rec.runId});
 return {status:'RESUMED' as const,state:after.state,gateMode:after.gateMode,reconcileRunId:rec.runId};
}
