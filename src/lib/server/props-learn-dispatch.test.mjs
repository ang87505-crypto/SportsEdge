// "Retrain now": one fixed GitHub workflow dispatch. Synthetic token; fake fetch; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchPropsLearn,LEARN_DISPATCH_URL} from './props-learn-dispatch.ts';

const TOKEN='github_pat_'+'A'.repeat(40);
function fetcher(status){const calls=[];const f=async(url,init)=>{calls.push({url,init});return new Response(null,{status});};f.calls=calls;return f;}

test('not configured without a valid token, and no request is made',async()=>{
 const f=fetcher(204);
 assert.deepEqual(await dispatchPropsLearn({},f),{result:'not_configured'});
 assert.deepEqual(await dispatchPropsLearn({SPORTSEDGE_GITHUB_DISPATCH_TOKEN:'nope'},f),{result:'not_configured'});
 assert.equal(f.calls.length,0);
});

test('dispatches exactly the train kind on main to the fixed workflow',async()=>{
 const f=fetcher(204);
 assert.deepEqual(await dispatchPropsLearn({SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},f),{result:'dispatched'});
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0].url,LEARN_DISPATCH_URL);
 assert.match(LEARN_DISPATCH_URL,/\/repos\/ang87505-crypto\/SportsEdge\/actions\/workflows\/props-learn\.yml\/dispatches$/);
 assert.deepEqual(JSON.parse(f.calls[0].init.body),{ref:'main',inputs:{kind:'train'}});
 assert.equal(f.calls[0].init.headers.Authorization,'Bearer '+TOKEN);
});

test('GitHub refusals and outages are reported, never retried',async()=>{
 const refused=fetcher(422);
 assert.deepEqual(await dispatchPropsLearn({SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},refused),{result:'refused',code:'GITHUB_422'});
 assert.equal(refused.calls.length,1);
 assert.deepEqual(await dispatchPropsLearn({SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},fetcher(503)),{result:'unknown',code:'GITHUB_503'});
 const down=async()=>{throw new Error('offline');};
 assert.deepEqual(await dispatchPropsLearn({SPORTSEDGE_GITHUB_DISPATCH_TOKEN:TOKEN},down),{result:'unknown',code:'GITHUB_NETWORK'});
});
