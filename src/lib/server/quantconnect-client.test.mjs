import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {qcSignedHeaders,parseQcListing,verifyQuantConnect,listQuantConnect,requireQcConfig} from './quantconnect-client.ts';

const config={userId:'1234567',apiToken:'test-token-contains-at-least-sixteen-chars',projectId:37781863};
test('timestamp auth follows documented SHA-256 API scheme',()=>{
 const h=qcSignedHeaders(config.userId,config.apiToken,1760000000);
 const expected=createHash('sha256').update(config.apiToken+':1760000000').digest('hex');
 assert.equal(Buffer.from(h.Authorization.slice(6),'base64').toString('utf8'),config.userId+':'+expected);
 assert.equal(h.Timestamp,'1760000000');
 assert.throws(()=>qcSignedHeaders('wrong',config.apiToken,1760000000));
 assert.throws(()=>qcSignedHeaders('123','short',1760000000));
});
test('rejects invalid or missing QC settings',()=>{
 assert.throws(()=>requireQcConfig({...config,projectId:0}));
 assert.throws(()=>requireQcConfig({...config,userId:'1x'}));
 assert.throws(()=>requireQcConfig({...config,apiToken:''}));
});
test('verify only calls authenticated verification endpoint',async()=>{
 const requests=[];
 const fetcher=async(url,options)=>{
  requests.push({url,options});
  return new Response(JSON.stringify({success:true}),{status:200});
 };
 const res=await verifyQuantConnect(config,fetcher);
 assert.equal(res.status,'authenticated');
 assert.equal(res.historicalPerformanceVerified,false);
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://www.quantconnect.com/api/v2/authenticate');
 assert.equal(requests[0].options.method,'POST');
 assert.deepEqual(JSON.parse(requests[0].options.body),{});
});
test('list uses only fixed endpoint, strips profitability and raw data',async()=>{
 let req;
 const fetcher=async(url,options)=>{
   req={url,options};
   return new Response(JSON.stringify({success:true,backtests:[
    {backtestId:'abcdef0123456789',name:'SPY data check',created:'2026-10-13T12:00:00Z',status:'Completed.',netProfit:999},
    {backtestId:'5678abcdef012345',name:'Second',created:'2026-10-13T13:00:00Z',status:'Completed.'}
   ]}),{status:200});
 };
 const result=await listQuantConnect(config,fetcher);
 assert.equal(req.url,'https://www.quantconnect.com/api/v2/backtests/list');
 assert.deepEqual(JSON.parse(req.options.body),{projectId:37781863,includeStatistics:false});
 assert.deepEqual(result.backtests.map(x=>x.name),['Second','SPY data check']);
 assert.ok(!JSON.stringify(result).includes('999'));
 assert.equal(result.historicalPerformanceVerified,false);
 assert.equal(result.paperTradingEnabled,false);
});
test('incomplete/failed records are rejected, not presented as good research',()=>{
 for(const payload of [{success:false,backtests:[]},{success:true,backtests:{}},
  {success:true,backtests:[{status:'Completed.'}]}]) {
  assert.throws(()=>parseQcListing(payload,37781863));
 }
});
test('invalid credentials, invalid JSON and upstream errors fail closed',async()=>{
 await assert.rejects(verifyQuantConnect(config,async()=>new Response('denied',{status:401})));
 await assert.rejects(verifyQuantConnect(config,async()=>new Response('not json',{status:200})));
 await assert.rejects(listQuantConnect(config,async()=>new Response(JSON.stringify({success:false}),{status:200})));
});
test('no API mutation endpoint or market data extraction is in client',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('./quantconnect-client.ts',import.meta.url),'utf8');
 for(const bad of ['backtests/create','backtests/delete','live/create','orders/create',
                   'objectstore','backtests/optimize','files/create','/data/'])assert.ok(!source.includes(bad));
});
