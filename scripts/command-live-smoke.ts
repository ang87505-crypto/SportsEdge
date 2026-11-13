/**
 * OPTIONAL live-model smoke test for Command Center 2.0. SPENDS MONEY when run: owner approval required.
 * Not run by any workflow or test. It refuses to start without the explicit flag and a key.
 *
 *   ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/command-live-smoke.ts --i-approve-spend [--max-usd 0.05] [--model claude-opus-5-5]
 *
 * One question over the labelled SYNTHETIC assistant fixtures (no SportsEdge database access), at most 2 tool rounds and
 * 600 output tokens per call, with a hard spend cap enforced by the same reserve/settle ledger logic as production
 * (single-process ledger here, because this script is one process). Prints the worst-case cost before calling, then
 * the answer, the tools used and the actual cost. Default model: claude-opus-5-5 ($4/$20 per MTok); a cheaper model
 * such as claude-haiku-5-5 can be chosen with --model.
 */
import {runConversation,anthropicModel} from '../src/lib/command/llm.ts';
import {memoryLedger,worstCaseMicroUsd,PRICES_PER_MTOK} from '../src/lib/command/budget.ts';
import {makeRaw,NOW} from '../src/lib/assistant/fixtures.mjs';
import type {CommandPorts} from '../src/lib/command/tools.ts';
import type {Raw} from '../src/lib/props/dashboard-view.ts';

const argv=process.argv,opt=(n:string)=>{const i=argv.indexOf('--'+n);return i<0?null:argv[i+1];};
if(!argv.includes('--i-approve-spend')){console.error('Refusing: this calls a paid model. Re-run with --i-approve-spend after owner approval.');process.exit(2);}
const key=process.env.ANTHROPIC_API_KEY;if(!key){console.error('Refusing: ANTHROPIC_API_KEY is not set.');process.exit(2);}
const model=opt('model')??'claude-opus-5-5';
if(!PRICES_PER_MTOK[model]){console.error('Refusing: no known price for '+model);process.exit(2);}
const maxUsd=Math.min(Number(opt('max-usd')??'0.05'),0.25);
if(!(maxUsd>0)){console.error('Refusing: --max-usd must be > 0 (≤ 0.25)');process.exit(2);}

const ledger=memoryLedger(maxUsd,10);
const ports:CommandPorts={nowIso:NOW,ownerAccess:false,sports:async()=>makeRaw() as unknown as Raw,ops:async()=>null,research:async()=>null,lab:async()=>null,
 accounts:async()=>{throw new Error('not used');}};
console.log(`Model ${model}; cap $${maxUsd}; worst case per call ≈ $${(worstCaseMicroUsd(model,30_000,600)!/1e6).toFixed(4)} (30 KB request). Data: SYNTHETIC fixtures.`);
const out=await runConversation(await anthropicModel(model,key),{history:[],message:'How did our picks do yesterday, and which ones missed?',
 ports,ledger,clientKey:'live-smoke',maxOutputTokens:600,maxToolRounds:2});
console.log(JSON.stringify({ok:out.ok,...(out.ok?{text:out.text,rounds:out.rounds}:{reason:out.reason}),
 tools:out.results.map(r=>[r.tool,r.ok]),actualUsd:out.microUsd/1e6,committedUsd:ledger.committed()/1e6},null,1));
if(!out.ok)process.exitCode=1;
