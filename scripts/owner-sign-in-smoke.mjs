/** Exercise the built HTTP sign-in/cookie flow using an isolated synthetic key. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';

const key='0123456789abcdef'.repeat(4);
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
// Do not provide a real data, broker, dispatch or owner credential to this server.
const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>
 !/^(SPORTSEDGE_|ALPACA_|APCA_|SUPABASE_|ODDS_)/.test(name)));
env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY=' '+key+'\r\n';env.NODE_ENV='production';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],
 {cwd:process.cwd(),env,stdio:'ignore'});
const base='http://127.0.0.1:'+port;
// NextURL canonicalizes a loopback address to localhost, including req.url.
const origin='http://localhost:'+port;
const post=(body,requestOrigin=origin)=>fetch(base+'/api/internal/alpaca-paper/session',{
 method:'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin},body:JSON.stringify(body)});
try{
 let ready=false;
 for(let attempt=0;attempt<100;attempt++){
  if(child.exitCode!==null)throw Error('Isolated sign-in server exited before startup');
  try{await fetch(base+'/api/internal/paper-auto');ready=true;break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'the built server starts');
 assert.equal((await post({ownerKey:key},'https://other.example')).status,403,'cross-origin sign-in is refused');
 assert.equal((await post({ownerKey:'f'.repeat(64)})).status,401,'a different full-length key is refused');
 const response=await post({ownerKey:' \t'+key+'\r\n'});
 assert.equal(response.status,200,'the real route accepts a complete padded key');
 assert.equal((await response.json()).status,'authenticated');
 const setCookie=response.headers.get('set-cookie');
 for(const expected of ['__Host-sportsedge-alpaca-owner=','HttpOnly','Secure','SameSite=strict','Path=/','Max-Age=1800'])
  assert.ok(setCookie?.includes(expected),'signed cookie has '+expected);
 const cookie=setCookie.split(';')[0];
 const anonymous=await fetch(base+'/api/internal/paper-auto');
 assert.equal(anonymous.status,401,'protected endpoint refuses an anonymous request');
 const signedIn=await fetch(base+'/api/internal/paper-auto',{headers:{Cookie:cookie}});
 assert.equal(signedIn.status,503);
 assert.equal((await signedIn.json()).status,'paper_auto_not_configured',
  'the cookie passes authentication before the deliberately disconnected data layer');
 const tampered=cookie.slice(0,-1)+(cookie.at(-1)==='a'?'b':'a');
 assert.equal((await fetch(base+'/api/internal/paper-auto',{headers:{Cookie:tampered}})).status,401);
 const signOut=await fetch(base+'/api/internal/alpaca-paper/session',{method:'DELETE',headers:{Origin:origin,Cookie:cookie}});
 assert.equal(signOut.status,200);assert.ok(signOut.headers.get('set-cookie').includes('Max-Age=0'));
 console.log('OWNER_SIGN_IN_HTTP_PASS: padded key, wrong key, origin, signed cookie, protected route, tampering and logout');
}finally{
 if(child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
}
