import {createHash} from 'node:crypto';
import {buildIndependentWeatherMemory} from '../prediction-markets/kalshi/weather-memory.ts';
import {buildWeatherContractForecast,forecastInputFromMemory} from '../prediction-markets/kalshi/weather-distribution.ts';
import {independentLadder} from '../prediction-markets/kalshi/weather-contract-eval.ts';
import {normalizeMarket,normalizeBook} from '../prediction-markets/kalshi/client.ts';
export const NOW='2026-11-20T20:00:00.000Z';
export const FP='a'.repeat(64);
export const clone=x=>JSON.parse(JSON.stringify(x));
export function trainingFixture(count=35){return Array.from({length:count},(_,i)=>{
 const t=Date.UTC(2026,9,1+i);return {localDate:new Date(t).toISOString().slice(0,10),forecastHighF:60,
  observedHighF:59+i%3,forecastAvailableAt:new Date(t-86400000+7*3600000).toISOString(),
  observedAvailableAt:new Date(t+86400000+8*3600000).toISOString(),forecastSource:'NWS',observationSource:'NWS_CLI_PRELIMINARY_CENTRAL_PARK'};
});}
export function memoryFixture(){
 const fetchedAt='2026-11-20T07:00:00Z',start=Date.parse(fetchedAt)+3600000;
 const hourly=Array.from({length:48},(_,i)=>({startTime:new Date(start+i*3600000).toISOString(),
  endTime:new Date(start+(i+1)*3600000).toISOString(),temperatureF:60}));
 return buildIndependentWeatherMemory({source:'NWS_GRID_FORECAST_NOT_STATION_OBSERVATION',fetchedAt,
  forecastIssuedAt:'2026-11-20T06:00:00Z',gridForecastUrl:'https://api.weather.gov/gridpoints/OKX/33,37/forecast/hourly',
  sourceDigest:createHash('sha256').update(JSON.stringify(hourly)).digest('hex'),hourly});
}
export function forecastFixture(count=0){const m=memoryFixture();return buildWeatherContractForecast({
 input:forecastInputFromMemory(m),asOf:NOW,training:trainingFixture(count),strikes:independentLadder(60)});}
/** Transport double only. SQL constraints/concurrency are verified on real PostgreSQL separately. */
export function memoryStore(){
 const rows=new Map([['kalshi_platform_version',[{version:'kalshi-paper-platform-v1'}]],
  ['kalshi_demo_control',[{id:true,state:'STOPPED',key_fingerprint:null,checked_at:null}]]]);
 const calls=[];let sequence=0;
 const get=t=>{if(!rows.has(t))rows.set(t,[]);return rows.get(t);};
 const store={rows,calls,get,
  async select(table,query){calls.push(['select',table]);let out=clone(get(table));const q=new URLSearchParams(query);
   for(const [field,value] of q)if(value.startsWith('eq.'))out=out.filter(r=>String(r[field])===value.slice(3));
   const order=q.get('order');if(order){const [field,direction]=order.split('.');out.sort((a,b)=>String(a[field]).localeCompare(String(b[field]))*(direction==='desc'?-1:1));}
   return out.slice(0,Number(q.get('limit')??10000));
  },
  async insert(table,incoming){calls.push(['insert',table]);for(const v of incoming)get(table).push({...clone(v),id:v.id??++sequence,recorded_at:NOW});},
  async rpc(name,args){calls.push(['rpc',name,clone(args)]);
   if(name==='kalshi_begin_run'){
    const old=get('kalshi_platform_runs').find(x=>x.slot===args.p_slot&&x.status==='COMPLETED');
    if(old)return {claimed:false,status:old.status};
    const row={id:'run-'+ ++sequence,token:'token',slot:args.p_slot,status:'RUNNING',started_at:NOW,finished_at:null,summary:{}};
    get('kalshi_platform_runs').push(row);return {claimed:true,id:row.id,token:row.token};
   }
   if(name==='kalshi_finish_run'){
    const row=get('kalshi_platform_runs').find(x=>x.id===args.p_id);row.status=args.p_status;row.summary=args.p_summary;row.finished_at=NOW;return null;
   }
   if(name==='kalshi_record_contract_forecast'){
    const f=JSON.parse(args.p_document),old=get('kalshi_contract_forecasts').find(x=>x.target_date===f.input.targetLocalDate);
    if(old)return old.id;get('kalshi_contract_forecasts').push({id:f.id,model_id:f.modelId,target_date:f.input.targetLocalDate,as_of:f.asOf,document:args.p_document,recorded_at:NOW});return f.id;
   }
   if(name==='kalshi_save_fixture_ledger'){
    const old=get('kalshi_fixture_ledgers').at(-1);
    if(old?.document===args.p_document)return old.revision;
    if((old?.revision??0)!==args.p_expected_revision)throw Error('KALSHI_REVISION_CONFLICT');
    const row={study_id:args.p_study,revision:args.p_expected_revision+1,document:args.p_document,recorded_at:NOW};get('kalshi_fixture_ledgers').push(row);return row.revision;
   }
   if(name==='kalshi_set_demo_control'){
    Object.assign(get('kalshi_demo_control')[0],{state:args.p_state,key_fingerprint:args.p_fingerprint,checked_at:NOW});return null;
   }
   if(name==='kalshi_note_demo_check'){
    const c=get('kalshi_demo_control')[0];
    if(c.state!=='ARMED'||c.key_fingerprint!==args.p_fingerprint)throw Error('KALSHI_DEMO_NOT_ARMED');
    c.checked_at=NOW;return null;
   }
   if(name==='kalshi_claim_demo_intent'){
    if(get('kalshi_demo_intents').some(i=>i.ticker===args.p_ticker))throw Error('KALSHI_DEMO_ALREADY_ATTEMPTED');
    const intent={id:'00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'),ticker:args.p_ticker,side:args.p_side,
     price_micros:args.p_price,kind:args.p_kind,key_fingerprint:args.p_fingerprint,close_at:args.p_close,created_at:NOW,decision_document:args.p_decision};
    get('kalshi_demo_intents').push(intent);return intent;
   }
   throw Error('Unexpected RPC: '+name);
  }
 };
 return store;
}
export function demoFixture(){
 const calls=[],account={source:'KALSHI_DEMO',fetchedAt:NOW,cashMicros:10_000_000,portfolioValueMicros:0,orders:[],positions:[]};
 const client={calls,accountData:account,fingerprint:FP,
  async account(){calls.push('account');return clone(account);},
  async markets(eventTicker){calls.push('markets');return [
   {market:normalizeMarket({ticker:eventTicker+'-T60',event_ticker:eventTicker,market_type:'binary',status:'active',
    title:'Synthetic Central Park weather',rules_primary:'Central Park test rules',close_time:'2026-11-22T05:00:00Z'},'KXHIGHNY',NOW),strike:{kind:'below',thresholdF:60}},
   {market:normalizeMarket({ticker:eventTicker+'-T61',event_ticker:eventTicker,market_type:'binary',status:'active',
    title:'Synthetic Central Park weather',rules_primary:'Central Park test rules',close_time:'2026-11-22T05:00:00Z'},'KXHIGHNY',NOW),strike:{kind:'at_least',thresholdF:60}}
  ];},
  async book(ticker){calls.push('book');return normalizeBook(ticker,{orderbook_fp:{yes_dollars:[['0.05','5.00']],no_dollars:[['0.90','5.00']]}},NOW);},
  async submit(i){calls.push(['submit',clone(i)]);return {source:'KALSHI_DEMO',orderId:'10000000-0000-4000-8000-000000000001',clientOrderId:i.clientOrderId,
   filledMicros:500000,remainingMicros:0,averageYesPriceMicros:i.priceMicros,averageFeeMicros:10000,processedAt:NOW};},
  async cancel(){calls.push('cancel');},async result(){return null;}
 };
 return client;
}
