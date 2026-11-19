/** Content-addressed research memory. No network or model writes; append-only objects and immutable run receipts. */
import {readFileSync,writeFileSync,appendFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checksum} from '../src/lib/research/provenance.ts';
import {INTAKE_INDEX,intakeIndex,type IntakeReceipt} from '../src/lib/research/archive.ts';
export {intakeIndex} from '../src/lib/research/archive.ts';
const json=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
function stable(raw:Record<string,unknown>){
 const out={...raw};delete out.retrievedAt;
 if(out.content&&typeof out.content==='object'){
  const content={...(out.content as Record<string,unknown>)};delete content.retrievedAt;out.content=content;
 }
 if(out.quality&&typeof out.quality==='object'){
  const quality={...(out.quality as Record<string,unknown>)};delete quality.publicationAgeDays;out.quality=quality;
 }
 return out;
}
export function restoreIntake(data:string,out:string,nowIso:string){
 const now=Date.parse(nowIso);if(!Number.isFinite(now))throw Error('INTAKE_BAD_CLOCK');
 const path=join(data,INTAKE_INDEX),rows=existsSync(path)?intakeIndex(readFileSync(path,'utf8')):[];
 const r=rows.filter(r=>r.status==='OK'&&Date.parse(r.at)<=now).at(-1);
 mkdirSync(out,{recursive:true});
 if(r){const manifest=json(join(data,'research-intake','runs',r.runId,'manifest.json'));
  if(checksum(manifest)!==r.manifestSha256)throw Error('INTAKE_MANIFEST_DIGEST');
  writeFileSync(join(out,'previous-manifest.json'),JSON.stringify(manifest)+'\n');}
 const latest=rows.filter(r=>Date.parse(r.at)<=now).at(-1);
 const recentPartial=latest?.status==='PARTIAL'&&now-Date.parse(latest.at)<6*3600_000;
 return {restored:r?.runId??null,collect:!recentPartial&&(!r||r.at.slice(0,10)!==nowIso.slice(0,10))};
}
export function publishIntake(data:string,out:string,runId:string,sourceCommit:string){
 if(!/^\d{1,24}-\d{1,5}$/.test(runId)||!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('INTAKE_BAD_RUN');
 const index=join(data,INTAKE_INDEX),rows=existsSync(index)?intakeIndex(readFileSync(index,'utf8')):[];
 const manifest=json(join(out,'manifest.json')),report=json(join(out,'report.json'));
 const sources=Object.values(report.sources??{}) as {connected:string}[];
 if(!Number.isFinite(Date.parse(report.retrievedAt))||!sources.length||sources.some(s=>!['VERIFIED_THIS_RUN','PARTIAL','FAILED'].includes(s.connected))||
  !Array.isArray(manifest.items)||manifest.items.length>120||manifest.items.some((r:{id:string;checksum:string})=>typeof r.id!=='string'||!/^[a-f0-9]{64}$/.test(r.checksum)))throw Error('INTAKE_BAD_REPORT');
 const objects:{id:string;sha256:string}[]=[],files:{id:string;value:Record<string,unknown>}[]=[];
 const facts=join(out,'sec-companyfacts');
 if(existsSync(facts))for(const f of readdirSync(facts).filter(f=>/^CIK\d{10}\.json$/.test(f)))files.push({id:f.slice(0,-5),value:stable(json(join(facts,f)))});
 if(existsSync(join(out,'literature-leads.json')))for(const r of json(join(out,'literature-leads.json'))){
  if(!r.sourceId||!r.sourceItemId)throw Error('INTAKE_BAD_ITEM');files.push({id:r.sourceId+':'+r.sourceItemId,value:stable(r)});
 }
 if(files.length>120||new Set(files.map(f=>f.id)).size!==files.length)throw Error('INTAKE_BAD_ITEM');
 const dir=join(data,'research-intake','objects'),pending:{path:string;value:Record<string,unknown>}[]=[];
 let added=0,reused=0;
 for(const {id,value} of files){const sha256=checksum(value),path=join(dir,sha256+'.json');objects.push({id,sha256});
  if(existsSync(path)){if(checksum(json(path))!==sha256)throw Error('INTAKE_OBJECT_DIGEST');reused++;}
  else{pending.push({path,value});added++;}}
 const status=sources.every(s=>s.connected==='VERIFIED_THIS_RUN')?'OK':'PARTIAL';
 const receipt:IntakeReceipt={schema:'research-intake-archive-v1',runId,at:report.retrievedAt,sourceCommit,status,
  manifestSha256:checksum(manifest),reportSha256:checksum(report),objectsSha256:checksum(objects),
  reviewQueue:report.literature?.reviewQueue??0,quarantined:report.literature?.quarantined??0,objectsAdded:added,objectsReused:reused};
 const previous=rows.find(r=>r.runId===runId),root=join(data,'research-intake','runs',runId);
 if(previous){
  if(previous.sourceCommit!==sourceCommit)throw Error('INTAKE_IMMUTABLE_RUN');
  for(const [name,value] of [['manifest',manifest],['report',report],['objects',objects]] as const)if(checksum(json(join(root,name+'.json')))!==checksum(value))throw Error('INTAKE_IMMUTABLE_RUN');
  return {receipt:previous,alreadyPublished:true};
 }
 intakeIndex(JSON.stringify(receipt));mkdirSync(root,{recursive:true});mkdirSync(dir,{recursive:true});
 for(const {path,value} of pending)writeFileSync(path,JSON.stringify(value)+'\n',{flag:'wx'});
 for(const [name,value] of [['manifest',manifest],['report',report],['objects',objects]] as const)writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,1)+'\n',{flag:'wx'});
 appendFileSync(index,JSON.stringify(receipt)+'\n');return {receipt,alreadyPublished:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2),opt=(k:string)=>{const i=args.indexOf('--'+k);if(i<0||!args[i+1])throw Error('INTAKE_MISSING_'+k);return args[i+1];};
 if(args[0]==='restore')console.log(JSON.stringify(restoreIntake(opt('data'),opt('out'),new Date().toISOString())));
 else if(args[0]==='publish')console.log(JSON.stringify(publishIntake(opt('data'),opt('out'),opt('run-id'),opt('source-commit'))));
 else throw Error('INTAKE_BAD_COMMAND');
}
