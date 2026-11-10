/** Runtime owner-session metadata validation for event handlers and effects. Not authorization. */
export type AssistantAccess={ownerAccess:boolean;ownerExpiresAt:number|null};
export function parseOwnerAccess(v:unknown,now:number):AssistantAccess{
 if(v&&typeof v==='object'){
  const x=v as Record<string,unknown>;
  if(x.ownerAccess===true&&typeof x.ownerExpiresAt==='number'&&Number.isSafeInteger(x.ownerExpiresAt)&&
   x.ownerExpiresAt>now&&x.ownerExpiresAt<=now+30*60_000)return {ownerAccess:true,ownerExpiresAt:x.ownerExpiresAt};
 }
 return {ownerAccess:false,ownerExpiresAt:null};
}
export function currentOwnerAccess(v:unknown):AssistantAccess{return parseOwnerAccess(v,Date.now());}
