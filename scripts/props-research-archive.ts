/** Publish an immutable, aggregate-only receipt from an existing props snapshot. No network or database access. */
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {makePropsResearchEvidence,propsResearchFilename,verifyPropsResearchEvidence,PROPS_RESEARCH_DIRECTORY,PROPS_RESEARCH_FILE} from '../src/lib/lab/engine/props-research.ts';
import {fingerprint} from '../src/lib/lab/engine/experiments.ts';

const args=process.argv.slice(2);
const opt=(name:string)=>{const i=args.indexOf('--'+name);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error('PROPS_ARCHIVE_MISSING_'+name);return args[i+1];};
const evidence=makePropsResearchEvidence(JSON.parse(readFileSync(opt('snapshot'),'utf8')),opt('run-id'),opt('source-commit'));
const now=Date.parse(args.includes('--now')?opt('now'):new Date().toISOString());
if(!Number.isFinite(now)||Date.parse(evidence.asOf)>now)throw Error('PROPS_ARCHIVE_FUTURE_EVIDENCE');
const root=join(opt('data'),PROPS_RESEARCH_DIRECTORY),name=propsResearchFilename(evidence);
mkdirSync(root,{recursive:true});
const files=readdirSync(root).filter(f=>f.endsWith('.json'));
if(files.some(f=>!PROPS_RESEARCH_FILE.test(f)))throw Error('PROPS_ARCHIVE_BAD_FILENAME');
const previous=files.filter(f=>f.endsWith('-'+evidence.runId+'.json'));
if(previous.length>1||previous.some(f=>f!==name))throw Error('PROPS_ARCHIVE_IMMUTABLE_RUN');
if(existsSync(join(root,name))){
 const old=verifyPropsResearchEvidence(JSON.parse(readFileSync(join(root,name),'utf8')));
 if(fingerprint(old)!==fingerprint(evidence))throw Error('PROPS_ARCHIVE_IMMUTABLE_RUN');
}else writeFileSync(join(root,name),JSON.stringify(evidence,null,1)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'PROPS_RESEARCH_EVIDENCE_ARCHIVED',runId:evidence.runId,asOf:evidence.asOf,
 graded:evidence.gap.baseline.n,alreadyPublished:previous.length===1,providerCalls:0,ledgerWrites:0,promotionEnabled:false}));
