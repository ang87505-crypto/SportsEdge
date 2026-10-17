// Discovers every *.test.mjs under src/ and scripts/ and runs them in one
// `node --test` process. Fails if discovery finds nothing, because a glob that
// matches no files makes `node --test` exit 0 with zero tests.
import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

const ROOTS=['src','scripts'];
const SKIP=new Set(['node_modules','.next']);
async function find(dir){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(!SKIP.has(entry.name))out.push(...await find(full));}
    else if(entry.name.endsWith('.test.mjs'))out.push(full);
  }
  return out;
}
const files=(await Promise.all(ROOTS.map(find))).flat().sort();
if(!files.length){console.error('No *.test.mjs files found under '+ROOTS.join(', '));process.exit(1);}
console.log(`Running ${files.length} JavaScript test files.`);
const child=spawn(process.execPath,['--experimental-strip-types','--test',...files],{stdio:'inherit'});
child.on('exit',(code,signal)=>process.exit(signal?1:code??1));
