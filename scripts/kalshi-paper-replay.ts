/** Offline synthetic replay only; no account, API key or network is needed. */
import {openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {buildKalshiFixtureReplay} from '../src/lib/prediction-markets/kalshi/paper-fixture.ts';

const args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--output'||!args[1]))
 throw Error('Usage: node --experimental-strip-types scripts/kalshi-paper-replay.ts [--output NEW_FILE]');
const output=buildKalshiFixtureReplay();
const encoded=JSON.stringify(output,null,2)+'\n';
if(args.length){
 // Exclusive creation: never replace an existing result, ledger or user's file.
 const file=openSync(args[1],'wx',0o600);
 try{writeFileSync(file,encoded,'utf8');fsyncSync(file);}finally{closeSync(file);}
}
process.stdout.write(encoded);
