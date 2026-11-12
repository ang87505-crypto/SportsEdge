/** Pure analysis for the props activation preflight (scripts/props-activation-preflight.mjs). No I/O, no clock. */
export const EXPECTED_PROJECT='vfyzbliksooljxrlfadp';
export const APPROVED={daily:7,monthly:200,floor:60};
export const CAPTURE_TABLES=['props_capture_plans','props_captures','props_capture_outcomes'];

/** PostgREST "relation does not exist" codes (PGRST205 schema cache, 42P01 Postgres). */
export const missingRelation=(code)=>code==='PGRST205'||code==='42P01';
/** "column does not exist" (42703 Postgres, PGRST204 schema cache). */
export const missingColumn=(code)=>code==='42703'||code==='PGRST204';

/** The policy in force at `nowMs`: the latest row whose active_from has passed. */
export function activePolicy(rows,nowMs){
 return [...rows].filter(r=>Date.parse(r.active_from)<=nowMs).sort((a,b)=>Date.parse(b.active_from)-Date.parse(a.active_from))[0]??null;
}

/**
 * Rolling credit use. `charged` maps reservation id -> provider-reported x-requests-last; it is used only when the
 * policy counts provider actuals, and an unknown charge always counts in full (as the worker and database do).
 */
export function creditUse(reservations,charged,countsActuals,nowMs,policies=[]){
 const eff=r=>{const c=countsActuals?charged.get(Number(r.id)):undefined;return c===undefined?Number(r.credits):Math.min(Number(r.credits),Number(c));};
 const t=r=>Date.parse(r.reserved_at);
 const in24=reservations.filter(r=>nowMs-t(r)<86400_000),in30=reservations.filter(r=>nowMs-t(r)<30*86400_000);
 // Worst rolling 24-hour window ending at any reservation in the last 30 days (the cap must never be exceeded).
 const sorted=[...in30].sort((a,b)=>t(a)-t(b));
 let worst=0,worstAt=null;
 for(const end of sorted){const s=sorted.filter(r=>t(r)<=t(end)&&t(end)-t(r)<86400_000).reduce((a,r)=>a+eff(r),0);if(s>worst){worst=s;worstAt=end.reserved_at;}}
 const sum=xs=>xs.reduce((a,r)=>a+eff(r),0),raw=xs=>xs.reduce((a,r)=>a+Number(r.credits),0);
 return {used24h:sum(in24),used30d:sum(in30),reserved24h:raw(in24),reserved30d:raw(in30),worstRolling24h:worst,worstRolling24hAt:worstAt,
  unknownCharges:in30.filter(r=>!charged.has(Number(r.id))).length,
  // Each rolling window judged by the policy in force when it ended (a later, stricter policy is not retroactive).
  capBreaches:sorted.flatMap(end=>{const pol=activePolicy(policies,t(end));if(!pol)return [];
   const s=sorted.filter(r=>t(r)<=t(end)&&t(end)-t(r)<86400_000).reduce((a,r)=>a+eff(r),0);
   return s>Number(pol.daily_credits)?[{at:end.reserved_at,credits:s,policy:pol.version,cap:Number(pol.daily_credits)}]:[];})};
}

/** Entries per account per New York day (the database's own day boundary) above the account's cap. */
export function entryCapBreaches(entries,accounts){
 const day=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
 const cap=new Map(accounts.map(a=>[Number(a.id),Number(a.max_entries_per_day)]));
 const n=new Map();
 for(const e of entries){const k=e.account_id+'|'+day(e.created_at);n.set(k,(n.get(k)??0)+1);}
 return [...n].filter(([k,c])=>c>(cap.get(Number(k.split('|')[0]))??Infinity)).map(([k,c])=>({account:Number(k.split('|')[0]),day:k.split('|')[1],entries:c}));
}

/** Duplicate keys in rows (must be empty: the database has unique constraints; this checks they held). */
export function duplicates(rows,key){
 const n=new Map();for(const r of rows){const k=key(r);n.set(k,(n.get(k)??0)+1);}
 return [...n].filter(([,c])=>c>1).map(([k,c])=>({key:k,count:c}));
}

/** The overall verdict for each activation step, from the facts gathered. */
export function verdict(f){
 const out=[];
 const ok=(id,pass,detail)=>out.push({id,state:pass===null?'UNKNOWN':pass?'PASS':'FAIL',detail});
 ok('target',f.project===EXPECTED_PROJECT,`Supabase project ${f.project??'unknown'} (expected ${EXPECTED_PROJECT}).`);
 const p=f.activePolicy;
 ok('limits',p?Number(p.daily_credits)===APPROVED.daily&&Number(p.monthly_credits)===APPROVED.monthly&&Number(p.provider_floor)===APPROVED.floor:null,
  p?`Active policy ${p.version}: ${p.daily_credits}/day, ${p.monthly_credits}/30 days, floor ${p.provider_floor}.`:'No active policy row readable.');
 ok('cap-held',f.credits?(f.credits.capBreaches??[]).length===0:null,f.credits?`Rolling 24 h windows over the policy in force: ${(f.credits.capBreaches??[]).length}. Peak ${f.credits.worstRolling24h} credits at ${f.credits.worstRolling24hAt??'n/a'}; now ${f.credits.used24h}/${APPROVED.daily}.`:'Reservations not readable.');
 ok('provider-floor',f.providerRemaining===null||f.providerRemaining===undefined?null:f.providerRemaining>=APPROVED.floor,`Provider last reported ${f.providerRemaining??'nothing'} remaining (floor ${APPROVED.floor}).`);
 ok('no-duplicate-runs',f.duplicateRuns?f.duplicateRuns.length===0:null,`${f.duplicateRuns?.length??'?'} duplicated run slots.`);
 ok('entry-caps-held',f.entryCapBreaches?f.entryCapBreaches.length===0:null,`${f.entryCapBreaches?.length??'?'} account-days over the entry cap.`);
 ok('settlement-running',f.lastCompletedSettleAt?f.nowMs-Date.parse(f.lastCompletedSettleAt)<36*3600_000:false,`Last completed settle ${f.lastCompletedSettleAt??'none'}.`);
 const caps=f.captureTables??{};
 const present=CAPTURE_TABLES.filter(t=>caps[t]==='PRESENT').length;
 out.push({id:'capture-schema',state:present===3?'APPLIED':present===0&&CAPTURE_TABLES.every(t=>caps[t]==='MISSING')?'NOT_APPLIED':'UNKNOWN',
  detail:CAPTURE_TABLES.map(t=>`${t}: ${caps[t]??'UNKNOWN'}`).join(', ')});
 if(f.duplicateClaims)ok('capture-claims-unique',f.duplicateClaims.length===0&&(f.duplicatePlans??[]).length===0&&!f.claimsWithoutOutcome,
  `${f.duplicateClaims.length} duplicate claims, ${(f.duplicatePlans??[]).length} duplicate plans, ${f.claimsWithoutOutcome??0} claims without an outcome after 15 min.`);
 out.push({id:'v3-accounting',state:f.v3Column==='PRESENT'?(p?.count_provider_actuals===true?'APPLIED_AND_ACTIVE':'APPLIED_NOT_ACTIVE'):f.v3Column==='MISSING'?'NOT_APPLIED':'UNKNOWN',
  detail:`count_provider_actuals column: ${f.v3Column??'UNKNOWN'}.`});
 return out;
}
