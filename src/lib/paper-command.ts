/** Durable per-command NBA owner-run workflow. No strategy or account calculation lives here. */
export type CommandClaim =
 |{state:'claimed'}
 |{state:'replayed'; result:unknown}
 |{state:'blocked'};
export type CommandResult =
 |{state:'completed'|'replayed';result:unknown}
 |{state:'blocked'|'unavailable'|'uncertain'};
export interface PaperCommandStore {
 claim(commandId:string):Promise<CommandClaim>;
 finish(commandId:string,state:'completed'|'uncertain',result:unknown):Promise<void>;
}
export function validCommandId(value:unknown):value is string{
 return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function hasUncertainWrite(result:unknown):boolean{
 if(!result||typeof result!=='object')return false;
 const failed=(result as {failedGames?:unknown}).failedGames;
 return Array.isArray(failed)&&failed.length>0;
}
export async function guardedNbaRun(commandId:string,store:PaperCommandStore,runner:()=>Promise<unknown>):Promise<CommandResult>{
 if(!validCommandId(commandId))return {state:'blocked'};
 let claim:CommandClaim;
 try{claim=await store.claim(commandId);}catch{return {state:'unavailable'};}
 if(claim.state==='blocked')return {state:'blocked'};
 if(claim.state==='replayed')return {state:'replayed',result:claim.result};
 // The database claim has been durably written before any runner logic is invoked.
 // Once claimed, even a timeout/unknown write is NEVER automatically retried.
 let result:unknown;
 try{result=await runner();}catch{
  try{await store.finish(commandId,'uncertain',null);}catch{/* still running: slot stays locked */}
  return {state:'uncertain'};
 }
 if(hasUncertainWrite(result)){
  try{await store.finish(commandId,'uncertain',result);}catch{/* still running: slot stays locked */}
  return {state:'uncertain'};
 }
 try{await store.finish(commandId,'completed',result);}catch{
  // A successful batch can have a lost receipt response. Keep result uncertain.
  return {state:'uncertain'};
 }
 return {state:'completed',result};
}
