// Headless browser smoke suite for SportsEdge. Read-only, no dependencies beyond Node and Chrome.
// Starts against an uncredentialed Next.js production server in CI; never issues mutation POSTs.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base=process.env.BASE_URL??'http://127.0.0.1:3100';
const output=process.env.BROWSER_QA_OUTPUT??'artifacts/browser-qa';
const executable=process.env.CHROME_BIN??'google-chrome';
const routes=['/','/sports','/stocks','/paper-betting','/connections','/guide','/research/nba','/research/epl','/opportunities'];
const widths=[320,390,768,1024,1440];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const profile=await mkdtemp(path.join(os.tmpdir(),'sportsedge-smoke-'));
let chrome,ws;
const failures=[],results=[];
async function until(probe,label,max=18000){
 const end=Date.now()+max;
 while(Date.now()<end){try{const value=await probe();if(value)return value;}catch{}await delay(150);}
 throw Error('Timeout while waiting for '+label);
}
function rpc(socket){
 let next=0;const waiting=new Map();
 socket.addEventListener('message',({data})=>{const message=JSON.parse(data);if(!message.id||!waiting.has(message.id))return;
  const item=waiting.get(message.id);waiting.delete(message.id);
  message.error?item.reject(Error(message.error.message)):item.resolve(message.result);
 });
 socket.addEventListener('close',()=>{for(const p of waiting.values())p.reject(Error('Browser disconnected'));waiting.clear();});
 return (method,params={})=>new Promise((resolve,reject)=>{const id=++next;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
}
async function evaluate(command,expression){
 const value=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(value.exceptionDetails)throw Error(value.exceptionDetails.text);
 return value.result.value;
}
try{
 await mkdir(output,{recursive:true});
 await until(async()=>(await fetch(base)).ok,'local Next.js production server',40000);
 chrome=spawn(executable,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
 const port=await until(async()=>(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0],'Chrome debugging endpoint');
 const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 ws=new WebSocket(tab.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 const send=rpc(ws);
 await send('Page.enable');await send('Runtime.enable');
 for(const route of routes){
  const sizes=['/','/sports','/stocks'].includes(route)?widths:[390,1440];
  for(const width of sizes){
   const label=`${route==='/'?'overview':route.slice(1).replaceAll('/','-')}-${width}`;
   try{
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    const navigation=await send('Page.navigate',{url:base+route});
    if(navigation.errorText)throw Error(navigation.errorText);
    await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('main#main-content')`),label+' main landmark',25000);
    await delay(200);
    const data=await evaluate(send,`(()=>{
     const main=document.querySelector('main#main-content');
     const isTool=location.pathname.startsWith('/research')||location.pathname==='/guide'||location.pathname==='/connections';
     const nav=document.querySelector(innerWidth<=760?'nav[aria-label="Mobile navigation"]':(isTool?'nav[aria-label="Research and tools"]':'nav[aria-label="Workspaces"]'));
     const heading=main?.querySelector('h1');
     return {route:location.pathname,viewport:innerWidth,scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),
      heading:heading?.textContent?.trim()??null,mainPresent:!!main,navVisible:!!nav&&getComputedStyle(nav).display!=='none',
      currentNav:nav?.querySelectorAll('a[aria-current="page"]').length??0,
      appError:document.body.innerText.includes('Application error:'),
      placeholders:[...main.querySelectorAll('a[href="#"]')].length};
    })()`);
    const issues=[];
    if(data.route!==route)issues.push('Wrong route');
    if(!data.mainPresent)issues.push('Missing main landmark');
    if(!data.navVisible)issues.push('Primary navigation hidden');
    if(data.currentNav!==1)issues.push('Expected exactly one active navigation link');
    if(data.scrollWidth>width+3)issues.push(`Page overflows viewport by ${data.scrollWidth-width}px`);
    if(data.appError)issues.push('Next.js application error');
    if(data.placeholders)issues.push('Placeholder links detected');
    if(['/', '/sports','/stocks','/paper-betting','/connections','/guide'].includes(route)&&!data.heading)issues.push('Missing page heading');
    if(width===390||width===1440){
     const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     await writeFile(path.join(output,label+'.png'),Buffer.from(screenshot.data,'base64'));
    }
    results.push({...data,issues});
    if(issues.length)failures.push(`${label}: ${issues.join('; ')}`);
    console.log(`${issues.length?'FAIL':'PASS'} ${label} [${data.scrollWidth}px] ${data.heading??''}`);
   }catch(error){const reason=`${label}: ${error instanceof Error?error.message:String(error)}`;failures.push(reason);console.error('FAIL '+reason);}
  }
 }
 await writeFile(path.join(output,'results.json'),JSON.stringify({results,failures},null,2)+'\n');
 console.log(`Checked ${results.length} responsive route/viewport combinations; ${failures.length} failures.`);
 if(failures.length){for(const f of failures)console.error(f);process.exitCode=1;}
}catch(error){console.error(error);process.exitCode=1;
}finally{
 ws?.close();
 if(chrome){const stopped=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');await Promise.race([stopped,delay(2500)]);if(chrome.exitCode===null)chrome.kill('SIGKILL');}
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
