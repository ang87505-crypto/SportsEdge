/**
 * One outstanding assistant request per conversation. Every reset/logout
 * invalidates earlier async responses, including a stale owner-only reply.
 * Pure local control flow: no storage, network, credentials or timers.
 */
export class AssistantRequestGate {
 private sequence=0;
 private pending=false;
 start():number|null {
  if(this.pending)return null;
  this.pending=true;
  return ++this.sequence;
 }
 isCurrent(id:number):boolean {
  return Number.isSafeInteger(id)&&this.pending&&id===this.sequence;
 }
 finish(id:number):boolean {
  if(!this.isCurrent(id))return false;
  this.pending=false;
  return true;
 }
 invalidate():void {
  this.sequence++;
  this.pending=false;
 }
}
