import 'server-only';
import {reply,trustedMutation} from '../paper-control';
const COOKIE='__Host-sportsedge-paper';
function settings(){
 const address=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY,owner=process.env.SPORTSEDGE_OWNER_USER_ID,origin=process.env.SPORTSEDGE_SITE_ORIGIN;
 if(!address||!key||!owner||!origin)return null;
 try{const u=new URL(address),o=new URL(origin);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co')||u.pathname!=='/'||u.search||u.hash||o.protocol!=='https:'||o.origin!==origin||! /^[0-9a-f-]{36}$/i.test(owner))return null;return {address:u.origin,key,owner,origin};}catch{return null;}
}
function token(request:Request){const values=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(`${COOKIE}=`));if(values.length!==1)return null;const value=values[0].slice(COOKIE.length+1);return /^[A-Za-z0-9_.-]{20,8192}$/.test(value)?value:null;}
async function user(access:string){const c=settings();if(!c)return null;const response=await fetch(`${c.address}/auth/v1/user`,{headers:{apikey:c.key,Authorization:`Bearer ${access}`},cache:'no-store',signal:AbortSignal.timeout(8000)});if(response.status===401||response.status===403)return null;if(!response.ok)throw Error('Auth provider unavailable');return await response.json() as {id?:string;is_anonymous?:boolean;email_confirmed_at?:string};}
export async function ownerIdentity(request:Request){const c=settings();if(!c)return {configured:false,owner:false};const access=token(request);if(!access)return {configured:true,owner:false};const u=await user(access);return {configured:true,owner:u?.id===c.owner&&u.is_anonymous!==true&&Boolean(u.email_confirmed_at)};}
function cookie(value:string,seconds:number){return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;}
export async function ownerSession(request:Request){
 const c=settings();if(!trustedMutation(request,c?.origin))return reply({error:'Owner access is not configured or request origin was rejected.'},403);
 try{
  const raw=await request.text();if(raw.length>4096)return reply({error:'Request too large.'},413);
  const body=JSON.parse(raw);
  if(body.action==='logout'){
   // Revoke refresh capability if any exists; the stored access token is never returned to JS.
   const access=token(request);if(access)await fetch(`${c!.address}/auth/v1/logout?scope=local`,{method:'POST',headers:{apikey:c!.key,Authorization:`Bearer ${access}`},signal:AbortSignal.timeout(8000)}).catch(()=>undefined);
   const response=reply({owner:false});response.headers.set('Set-Cookie',cookie('',0));return response;
  }
  if(body.action!=='login'||typeof body.email!=='string'||body.email.length>254||typeof body.password!=='string'||body.password.length<1||body.password.length>1024)return reply({error:'Enter your owner email and password.'},400);
  const response=await fetch(`${c!.address}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:c!.key,'Content-Type':'application/json'},body:JSON.stringify({email:body.email,password:body.password}),cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return reply({error:'Sign-in failed or temporarily rate limited.'},response.status===429?429:401);
  const session=await response.json() as {access_token?:string;expires_in?:number};
  if(!session.access_token||! /^[A-Za-z0-9_.-]{20,8192}$/.test(session.access_token))throw Error('Invalid session');
  const u=await user(session.access_token);
  if(u?.id!==c!.owner||u.is_anonymous||!u.email_confirmed_at)return reply({error:'This account cannot operate paper trading.'},403);
  const out=reply({owner:true});out.headers.set('Set-Cookie',cookie(session.access_token,Math.max(1,Math.min(3600,Math.floor(session.expires_in??3600)))));return out;
 }catch{return reply({error:'Sign-in is unavailable. Try again later.'},503);}
}
