// Real Next.js route smoke test with an isolated, uncredentialed local server.
// The only owner key is generated below; no database, odds or broker credential is inherited.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
const port=probe.address().port;await new Promise(r=>probe.close(r));
const base='http://127.0.0.1:'+port,origin='http://localhost:'+port,key=randomBytes(32).toString('hex');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!['SPORTSEDGE_','ALPACA_','APCA_','SUPABASE_','ODDS_'].some(p=>k.startsWith(p))));
Object.assign(env,{SPORTSEDGE_PREVIEW_FIXTURES:'1',SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY:key,NEXT_TELEMETRY_DISABLED:'1'});
let log='';
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function ask(message,context=null,cookie=''){
 const r=await fetch(base+'/api/assistant',{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify({message,context})});
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);return r.json();
}
try{
 let ready=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/assistant')).ok){ready=true;break;}}catch{}await delay(100);}
 assert.ok(ready,'Local test server did not start');
 for(const path of ['/assistant','/stocks/research']){
  const r=await fetch(base+path),html=await r.text();assert.equal(r.status,200);
  assert.ok(html.includes(path==='/assistant'?'Ask SportsEdge':'Historical evaluation'));
 }
 assert.match((await ask('Stock results')).reply.text,/Sign in/);
 const research=await ask('Momentum research results');
 assert.equal(research.reply.context.domain,'research');assert.match(research.reply.text,/historical/i);
 assert.match((await ask('Why?',research.reply.context)).reply.text,/Failed checks/);
 const all=await ask('Is everything running?');
 for(const heading of ['Sports','Stock account','Stock research'])assert.ok(all.reply.text.includes(heading));
 assert.match((await ask('Buy OXY')).reply.text,/has not submitted/);
 const login=await fetch(base+'/api/internal/alpaca-paper/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({ownerKey:key})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await(await fetch(base+'/api/assistant',{headers:{Cookie:cookie}})).json()).ownerAccess,true);
 assert.doesNotMatch((await ask('Stock bot status',null,cookie)).reply.text,/Sign in/);
 assert.equal((await(await fetch(base+'/api/assistant')).json()).ownerAccess,false);
 console.log('SHARED_ASSISTANT_HTTP_PASS: pages, domain routing, research, follow-ups, partial outage, read-only actions and signed owner session');
}catch(error){console.error(error);console.error(log.slice(-2000));process.exitCode=1;}
finally{server.kill('SIGTERM');}
