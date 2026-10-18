// Headless browser smoke suite for SportsEdge. Read-only, no dependencies beyond Node and Chrome.
// Starts against an uncredentialed Next.js production server in CI; never issues mutation POSTs.
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const base=process.env.BASE_URL??'http://127.0.0.1:3100';
const output=process.env.BROWSER_QA_OUTPUT??'artifacts/browser-qa';
const executable=process.env.CHROME_BIN??'google-chrome';
const routes=['/','/sports','/stocks','/paper-betting','/progress','/testing','/guide','/stocks/alpaca','/stocks/research','/stocks/journal','/research/nba','/research/epl','/research/backtest'];
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
  const sizes=['/','/sports','/stocks','/paper-betting'].includes(route)?widths:[390,1440];
  for(const width of sizes){
   const label=`${route==='/'?'overview':route.slice(1).replaceAll('/','-')}-${width}`;
   try{
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    const navigation=await send('Page.navigate',{url:base+route});
    if(navigation.errorText)throw Error(navigation.errorText);
    await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('main#main-content')`),label+' main landmark',25000);
    // App Router streams page content after the document/main landmark; a blank
    // heading during hydration is not a usability failure. Wait for user-visible
    // content before capturing the screenshot or checking route assertions.
    if(['/', '/sports','/stocks','/paper-betting','/progress','/testing','/guide','/stocks/alpaca','/stocks/research','/stocks/journal'].includes(route)){
      await until(async()=>evaluate(send,`!!document.querySelector('main#main-content h1')`),label+' visible page heading',25000);
    }
    await delay(200);
    const data=await evaluate(send,`(()=>{
     const main=document.querySelector('main#main-content');
     // Desktop and tablet use the sidebar (full or icon rail); phones use the bottom tab bar.
     const mobile=innerWidth<=760;
     const nav=document.querySelector(mobile?'nav[aria-label="Mobile navigation"]':'nav[aria-label="Primary"]');
     const heading=main?.querySelector('h1');
     return {route:location.pathname,viewport:innerWidth,scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),
      heading:heading?.textContent?.trim()??null,mainPresent:!!main,navVisible:!!nav&&getComputedStyle(nav).display!=='none',
      currentNav:nav?.querySelectorAll(mobile?'[aria-current]':'a[aria-current="page"]').length??0,
      platformRoute:['/progress','/testing','/guide'].includes(location.pathname),
      appError:document.body.innerText.includes('Application error:'),
      mobileScrollbar:innerWidth<=760?getComputedStyle(nav).scrollbarWidth:null,
      placeholders:[...main.querySelectorAll('a[href="#"]')].length};
    })()`);
    const issues=[];
    if(data.route!==route)issues.push('Wrong route');
    if(!data.mainPresent)issues.push('Missing main landmark');
    if(!data.navVisible)issues.push('Primary navigation hidden');
    if(data.currentNav!==1)issues.push('Expected exactly one active navigation item');
    if(data.scrollWidth>width+3)issues.push(`Page overflows viewport by ${data.scrollWidth-width}px`);
    if(width<=760&&data.mobileScrollbar!=='none')issues.push('Mobile tab scrollbar is visible');
    if(data.appError)issues.push('Next.js application error');

    if(data.placeholders)issues.push('Placeholder links detected');
    if(!data.heading)issues.push('Missing page heading');
    if(width===390||width===1440){
     const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     await writeFile(path.join(output,label+'.png'),Buffer.from(screenshot.data,'base64'));
     if(['/', '/sports', '/stocks', '/paper-betting', '/stocks/research', '/research/nba'].includes(route)){
      const metrics=await send('Page.getLayoutMetrics');
      const pageHeight=Math.min(3500,Math.max(900,Math.ceil(metrics.cssContentSize?.height??metrics.contentSize?.height??900)));
      const full=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:pageHeight,scale:1}});
      await writeFile(path.join(output,label+'-full.png'),Buffer.from(full.data,'base64'));
     }
    }
    results.push({...data,issues});
    if(issues.length)failures.push(`${label}: ${issues.join('; ')}`);
    console.log(`${issues.length?'FAIL':'PASS'} ${label} [${data.scrollWidth}px] ${data.heading??''}`);
   }catch(error){const reason=`${label}: ${error instanceof Error?error.message:String(error)}`;failures.push(reason);console.error('FAIL '+reason);}
  }
 }
 // Exercise actual navigation, not only anchor presence. No forms or mutations are submitted.
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base+'/'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('main#main-content h1')`),'interactive mobile homepage');
  await delay(450);
  await evaluate(send,`(()=>{document.querySelector('nav[aria-label="Mobile navigation"] a[href="/stocks"]').click();return true})()`);
  await until(async()=>evaluate(send,`location.pathname==='/stocks' && !!document.querySelector('main h1')`),'mobile Stocks navigation',12000);
  console.log('PASS mobile navigation: Overview → Stocks');
  await evaluate(send,`(()=>{document.querySelector('nav[aria-label="Mobile navigation"] a[href="/"]').click();return true})()`);
  await until(async()=>evaluate(send,`location.pathname==='/' && !!document.querySelector('main h1')`),'mobile return to Overview',12000);
  console.log('PASS mobile navigation: Stocks → Overview');
 }catch(error){const message='Mobile navigation interaction: '+(error instanceof Error?error.message:String(error));failures.push(message);console.error('FAIL '+message);}
 // Overview command center, drawer navigation and keyboard-accessible quick navigation.
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base+'/'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && document.querySelectorAll('.status-list li').length>=5`),'overview system status');
  await delay(320);
  const honestStatus=await evaluate(send,`(()=>{const t=document.querySelector('.status-list').innerText;return t.includes('Real-money execution')&&t.includes('Not available')&&!t.includes('Running')})()`);
  if(!honestStatus)throw Error('Overview must state that real-money execution is not available and never claim automation is running');
  console.log('PASS overview: system status lists real-money execution as not available');
  await evaluate(send,`(()=>{document.querySelector('nav[aria-label="Mobile navigation"] button').click();return true})()`);
  await until(async()=>evaluate(send,`document.querySelector('dialog.drawer')?.open===true && !!document.querySelector('nav[aria-label="All sections"] a[href="/testing"]')`),'mobile navigation drawer');
  await evaluate(send,`(()=>{document.querySelector('nav[aria-label="All sections"] a[href="/stocks/research"]').click();return true})()`);
  await until(async()=>evaluate(send,`location.pathname==='/stocks/research' && !document.querySelector('dialog.drawer')?.open && !!document.querySelector('main h1')`),'drawer navigation closes and routes',12000);
  console.log('PASS mobile drawer: opens, lists every section, navigates and closes');
  await send('Page.navigate',{url:base+'/'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('.command-trigger')`),'command trigger');
  await delay(320);
  await evaluate(send,`(()=>{document.querySelector('.command-trigger').click();return true})()`);
  await until(async()=>evaluate(send,`document.querySelector('.command-dialog')?.open===true && document.activeElement?.matches('.command-search-field input')`),'accessible command menu');
  await evaluate(send,`(()=>{document.querySelector('.command-result[data-href="/stocks"]').click();return true})()`);
  await until(async()=>evaluate(send,`location.pathname==='/stocks' && !document.querySelector('.command-dialog')?.open`),'command palette Stocks navigation',12000);
  console.log('PASS command palette: opens, focuses search, navigates, closes');
 }catch(error){const message='Overview and navigation interactions: '+(error instanceof Error?error.message:String(error));failures.push(message);console.error('FAIL '+message);}
 // Progress hub filters and honest empty-state charts: read-only interaction checks.
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base+'/progress'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && document.querySelectorAll('.progress-filters button').length===4`),'progress board');
  await delay(550); // Wait for React hydration before dispatching an interaction.
  await evaluate(send,`(()=>{document.querySelectorAll('.progress-filters button')[1].click();return true})()`);
  await until(async()=>evaluate(send,`document.querySelectorAll('.progress-card-grid article').length===3 && document.querySelectorAll('.progress-filters button')[1].getAttribute('aria-pressed')==='true'`),'filtered stock research cards');
  console.log('PASS progress: stocks filter shows registered and blocked evidence');
  await send('Page.navigate',{url:base+'/stocks/journal'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('.stock-insights')`),'stock realized insights');
  const honest=await evaluate(send,`!!document.querySelector('.chart-empty') && !document.querySelector('.chart-graphic svg')`);
  if(!honest)throw Error('Empty manual stock journal must not display fabricated performance curve');
  console.log('PASS practice journal: empty manual journal shows no fabricated chart');
  await send('Page.navigate',{url:base+'/stocks'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('.operator-states')`),'stocks dashboard');
  await until(async()=>evaluate(send,`!document.querySelector('.operator-states li.is-current') && document.body.innerText.includes('Not connected on this deployment')`),'stocks dashboard truthful states',12000);
  console.log('PASS stocks: no operator state claimed and unconfigured broker shows no balances');
 }catch(error){const message='Progress and performance interactions: '+(error instanceof Error?error.message:String(error));failures.push(message);console.error('FAIL '+message);}
  // Test center: route discovery, mobile tour filters, and owner-only preview disclosure.
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base+'/testing'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && document.querySelectorAll('nav[aria-label="Testing checkpoints"] button').length===6`),'testing tour mounted');
  const defaultState=await evaluate(send,`({
    disabled:document.querySelector('.test-release-banner')?.innerText?.includes('Not released yet'),
    hasUnverified:document.querySelector('.test-status-grid')?.innerText?.includes('Not established'),
    menuEntry:!!document.querySelector('nav[aria-label="All sections"] a[href="/testing"]')
  })`);
  if(!defaultState.disabled||!defaultState.hasUnverified||!defaultState.menuEntry)
   throw Error('Testing hub must disclose unreleased state, private Preview route, and primary navigation');
  await evaluate(send,`(()=>{const v=[...document.querySelectorAll('.test-tour-filters button')].find(e=>e.textContent.trim()==='Blocked');if(!v)throw Error('missing blocked filter');v.click();return true;})()`);
  await until(async()=>evaluate(send,`document.querySelectorAll('.test-tour-steps button').length===1 && document.querySelector('.test-tour-detail')?.innerText?.includes('No paper or live orders')`),'blocked research gate');
  await evaluate(send,`(()=>{const v=[...document.querySelectorAll('.test-tour-filters button')].find(e=>e.textContent.trim()==='All');v.click();return true;})()`);
  await until(async()=>evaluate(send,`document.querySelectorAll('.test-tour-steps button').length===6`),'all testing checkpoints restored');
  await evaluate(send,`(()=>{document.querySelectorAll('.test-tour-steps button')[4].click();return true;})()`);
  await until(async()=>evaluate(send,`document.querySelector('.test-tour-detail')?.innerText?.includes('Private preview') && !!document.querySelector('.test-tour-detail a[href="/stocks/alpaca"]')`),'owner-paper tour link and note');
  console.log('PASS testing center: accessible filters, private broker path and blocked execution state');
  await send('Page.navigate',{url:base+'/stocks/alpaca'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('main h1')`),'protected paper viewer page');
  await until(async()=>evaluate(send,`document.querySelector('section[aria-label="Private Alpaca paper account"]')?.textContent?.includes('Owner sign-in not set up yet')`),'fail-closed broker viewer with no secrets');
  const isLocked=await evaluate(send,`!document.querySelector('main button')?.textContent?.includes('Submit order') && !document.querySelector('.stats-grid')?.textContent?.includes('Paper account equity')`);
  if(!isLocked)throw Error('Unconfigured broker viewer must not expose private balances or order controls');
  console.log('PASS private paper: no owner key, no account data or order submission controls');
 }catch(error){const message='Testing center / private paper smoke: '+(error instanceof Error?error.message:String(error));failures.push(message);console.error('FAIL '+message);}
 // Exercise backup preview and safe cancellation in the isolated CI browser. No write/restore.
 try{
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:base+'/stocks/journal'});
  await until(async()=>evaluate(send,`document.readyState==='complete' && !!document.querySelector('input[aria-label="Choose journal backup JSON"]')`),'journal import control');
  await delay(400);
  const selected=await evaluate(send,`(()=>{
   const input=document.querySelector('input[aria-label="Choose journal backup JSON"]');
   const backup=new File([JSON.stringify({version:1,watchlist:['AAPL'],trades:[]})],'ci-manual-journal.json',{type:'application/json'});
   const transfer=new DataTransfer();transfer.items.add(backup);input.files=transfer.files;
   input.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
  if(!selected)throw Error('Could not select safe local backup');
  await until(async()=>evaluate(send,`!!document.querySelector('.journal-backup-review') && document.querySelector('.journal-backup-review')?.innerText?.includes('1 watched symbols')`),'journal backup preview');
  const initiallyDisabled=await evaluate(send,`document.querySelector('.journal-backup-review .button-row .button')?.disabled===true`);
  if(!initiallyDisabled)throw Error('Restore must require explicit acknowledgement');
  await evaluate(send,`(()=>{document.querySelectorAll('.journal-backup-review button')[1].click();return true})()`);
  await until(async()=>evaluate(send,`!document.querySelector('.journal-backup-review')`),'backup cancel');
  const noWrite=await evaluate(send,`localStorage.getItem('sportsedge-stock-journal-v1')===null`);
  if(!noWrite)throw Error('Preview/cancel must never modify local journal');
  console.log('PASS manual journal: validates local JSON, requires confirmation, cancel does not write');
 }catch(error){const message='Journal backup browser interaction: '+(error instanceof Error?error.message:String(error));failures.push(message);console.error('FAIL '+message);}
 await writeFile(path.join(output,'results.json'),JSON.stringify({results,failures},null,2)+'\n');
 console.log(`Checked ${results.length} responsive route/viewport combinations; ${failures.length} failures.`);
 if(failures.length){for(const f of failures)console.error(f);process.exitCode=1;}
}catch(error){console.error(error);process.exitCode=1;
}finally{
 ws?.close();
 if(chrome){const stopped=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGTERM');await Promise.race([stopped,delay(2500)]);if(chrome.exitCode===null)chrome.kill('SIGKILL');}
 await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
