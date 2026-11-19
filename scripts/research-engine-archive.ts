/** Local archive publisher/restorer; the existing research-data helper handles Git transport. No network. */
import {appendFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ENGINE_ARCHIVE_VERSION,ENGINE_INDEX,engineRunPath,parseEngineIndex,parseEngineRegistry,verifyEngineRun,type EngineReceipt} from '../src/lib/lab/engine/archive.ts';
import {fingerprint} from '../src/lib/lab/engine/experiments.ts';

const args=process.argv.slice(2),mode=args[0];
const opt=(name:string)=>{const i=args.indexOf('--'+name);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('ENGINE_MISSING_'+name);return args[i+1];};
const data=opt('data'),state=opt('state'),index=join(data,ENGINE_INDEX);
const receipts=existsSync(index)?parseEngineIndex(readFileSync(index,'utf8')):[];
const json=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
if(mode==='restore'){
 mkdirSync(state,{recursive:true});
 const receipt=receipts.filter(r=>r.status==='OK').at(-1);
 if(receipt){
  const root=join(data,engineRunPath(receipt.runId));
  const verified=verifyEngineRun(receipt,json(join(root,'registry.json')),json(join(root,'report.json')));
  writeFileSync(join(state,'registry.json'),JSON.stringify(verified.registry,null,1)+'\n');
 }
 console.log(JSON.stringify({mode,restored:receipt?.runId??null}));
}else if(mode==='publish'){
 const runId=opt('run-id'),sourceCommit=opt('source-commit'),root=join(data,engineRunPath(runId));
 if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('ENGINE_BAD_SOURCE_COMMIT');
 const registry=parseEngineRegistry(json(join(state,'registry.json'))),report=json(join(state,'report.json'));
 if(!report||!['OK','FAILED'].includes(report.status)||!Number.isFinite(Date.parse(report.at)))throw Error('ENGINE_BAD_REPORT');
 const sports=report.domains?.sports;
 const summary=report.status==='FAILED'?`Evaluation failed: ${String(report.failure??'unknown').slice(0,200)}`:
  `${sports?.clean??0} clean graded lines; ${sports?.picks?.picks??0} selected picks; ${report.forward?.length??0} registered forward comparisons. No model changed.`;
 const receipt:EngineReceipt={schema:ENGINE_ARCHIVE_VERSION,runId,at:report.at,status:report.status,sourceCommit,
  registrySha256:fingerprint(registry),reportSha256:fingerprint(report),summary};
 parseEngineIndex(JSON.stringify(receipt));
 const previous=receipts.find(r=>r.runId===runId);
 if(previous){
  if(fingerprint(previous)!==fingerprint(receipt))throw Error('ENGINE_IMMUTABLE_RUN');
  verifyEngineRun(previous,json(join(root,'registry.json')),json(join(root,'report.json')));
 }else{
  mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'registry.json'),JSON.stringify(registry,null,1)+'\n',{flag:'wx'});
  writeFileSync(join(root,'report.json'),JSON.stringify(report,null,1)+'\n',{flag:'wx'});
  mkdirSync(join(data,'learning-engine'),{recursive:true});
  appendFileSync(index,JSON.stringify(receipt)+'\n');
 }
 console.log(JSON.stringify({mode,runId,status:report.status,alreadyPublished:!!previous}));
}else throw Error('ENGINE_BAD_ARCHIVE_COMMAND');
