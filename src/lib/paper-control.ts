/** Request policy shared by route handlers and offline integration tests. */
export type OwnerStatus={configured:boolean;owner:boolean};
export type ControlDeps={
 origin:()=>string|undefined;
 identity:(request:Request)=>Promise<OwnerStatus>;
 enabled:()=>boolean;
 run:()=>Promise<unknown>;
 refresh:()=>Promise<unknown>;
};
export function trustedMutation(request:Request,origin:string|undefined){
 if(!origin)return false;
 try{return new URL(origin).origin===origin&&new URL(request.url).origin===origin&&request.headers.get('origin')===origin&&request.headers.get('x-sportsedge-control')==='1'&&request.headers.get('content-type')?.split(';')[0]==='application/json';}catch{return false;}
}
export function reply(body:unknown,status=200){return Response.json(body,{status,headers:{'Cache-Control':'private, no-store','Vary':'Cookie'}});}
export function createPaperHandlers(deps:ControlDeps){
 return {
  async GET(request:Request){
   try{const identity=await deps.identity(request);return reply({...identity,enabled:deps.enabled(),stocksReady:false,stockReason:'The stock data feed and persistent paper ledger are not connected.'});}
   catch{return reply({error:'Account verification unavailable.'},503);}
  },
  async POST(request:Request){
   if(!trustedMutation(request,deps.origin()))return reply({error:'Request origin rejected.'},403);
   try{
    const identity=await deps.identity(request);
    if(!identity.configured)return reply({error:'Owner sign-in setup is incomplete.'},503);
    if(!identity.owner)return reply({error:'Owner sign-in required.'},401);
    if(!deps.enabled())return reply({error:'Paper execution is disabled pending release review.'},409);
    const raw=await request.text();if(raw.length>1024)return reply({error:'Request too large.'},413);
    const body=JSON.parse(raw);
    if(!body||!['sports','stocks'].includes(body.track)||!['run','refresh'].includes(body.action))return reply({error:'Choose a supported paper action.'},400);
    if(body.track==='stocks')return reply({error:'Stock execution is blocked: verified prices, a signal adapter and the persistent stock ledger must be connected first. No trade was placed.',status:'blocked'},409);
    const result=body.action==='run'?await deps.run():await deps.refresh();
    return reply({status:'completed',track:'sports',action:body.action,checkedAt:new Date().toISOString(),result});
   }catch(e){if(e instanceof SyntaxError)return reply({error:'Invalid JSON.'},400);return reply({status:'uncertain',error:'The run could not finish. Some positions or settlements may already be recorded. Refresh the ledger before retrying; no automatic retry was made.'},503);}
  }
 };
}
