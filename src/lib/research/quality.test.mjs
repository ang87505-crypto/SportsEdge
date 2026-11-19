import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOpenAlex} from './discovery.ts';
import {assessResearchLead} from './quality.ts';
const at='2026-11-19T12:00:00Z',body={results:[{id:'https://openalex.org/W123',title:'Basketball probability calibration',
 publication_date:'2026-11-01',type:'article',abstract_inverted_index:{probability:[0],calibration:[1],basketball:[2]},is_retracted:false,is_pulled:false}]};
test('a scholarly index is metadata, not a guarantee of peer review; relevant dated metadata enters a review queue',()=>{
 const [l]=parseOpenAlex(body,at);assert.equal(l.kind,'scholarly-metadata');
 const q=assessResearchLead(l,'basketball probability calibration',at);assert.equal(q.status,'REVIEW_QUEUE');assert.equal(q.peerReviewVerified,false);
});
test('withdrawn, future, stale, irrelevant and instruction-like records are quarantined',()=>{
 const [l]=parseOpenAlex(body,at);
 for(const change of [{retracted:true},{pulled:true},{publishedAt:'2027-01-01'},{publishedAt:'2026-02-30'},
  {retrievedAt:'2026-10-01T00:00:00Z'},{title:'Unrelated topic',abstract:'Unrelated contents'},
  {suspectedInjection:true},{abstract:''}])assert.equal(assessResearchLead({...l,...change},'basketball probability calibration',at).status,'QUARANTINED');
});
test('updated quality flags change the content identity so a formerly accepted record can be reviewed again',()=>{
 const a=parseOpenAlex(body,at)[0],b=parseOpenAlex({results:[{...body.results[0],is_retracted:true}]},at)[0];
 assert.notEqual(a.contentHash,b.contentHash);
});
