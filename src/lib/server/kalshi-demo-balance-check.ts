/** Owner-requested demo credential test. One balance GET; no market reads, storage or order capability. */
import {createPrivateKey,sign,constants,type KeyObject} from 'node:crypto';
import {demoFixedMicros,KalshiDemoError,KALSHI_DEMO_ORIGIN} from './kalshi-demo-client.ts';

const PATH='/trade-api/v2/portfolio/balance';
export type KalshiDemoConnectionResult={
 status:'DEMO_CONNECTION_VERIFIED';source:'KALSHI_DEMO';readOnly:true;cashMicros:number;checkedAt:string;
};

export async function checkKalshiDemoConnection(
 env:Readonly<Record<string,string|undefined>>=process.env,fetcher:typeof fetch=fetch,now:()=>number=Date.now,
):Promise<KalshiDemoConnectionResult>{
 if(env.SPORTSEDGE_PREVIEW_FIXTURES==='1')throw new KalshiDemoError('PREVIEW_FIXTURES');
 const keyId=env.KALSHI_DEMO_KEY_ID??'',pem=env.KALSHI_DEMO_PRIVATE_KEY?.replace(/\\n/g,'\n')??'';
 if(!keyId||!pem)throw new KalshiDemoError('ACCOUNT_NOT_CONFIGURED');
 if(!/^[A-Za-z0-9-]{8,100}$/.test(keyId)||pem.length<80||pem.length>12000)throw new KalshiDemoError('INVALID_KEY');
 let key:KeyObject;
 try{key=createPrivateKey(pem);}catch{throw new KalshiDemoError('INVALID_KEY');}
 if(key.asymmetricKeyType!=='ed25519'&&key.asymmetricKeyType!=='rsa')throw new KalshiDemoError('UNSUPPORTED_KEY_TYPE');
 if(key.asymmetricKeyType==='rsa'&&(key.asymmetricKeyDetails?.modulusLength??0)<2048)throw new KalshiDemoError('INVALID_KEY');
 const timestamp=now();
 if(!Number.isSafeInteger(timestamp)||timestamp<1_000_000_000_000||timestamp>8_640_000_000_000_000)
  throw new KalshiDemoError('INVALID_CLOCK');
 const message=Buffer.from(String(timestamp)+'GET'+PATH);
 let signature:string;
 try{signature=(key.asymmetricKeyType==='ed25519'?sign(null,message,key):
  sign('sha256',message,{key,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST})).toString('base64');}
 catch{throw new KalshiDemoError('INVALID_KEY');}
 let response:Response;
 try{
  response=await fetcher(KALSHI_DEMO_ORIGIN+PATH,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
   signal:AbortSignal.timeout(8000),headers:{Accept:'application/json','KALSHI-ACCESS-KEY':keyId,
    'KALSHI-ACCESS-TIMESTAMP':String(timestamp),'KALSHI-ACCESS-SIGNATURE':signature}});
 }catch{throw new KalshiDemoError('TRANSPORT_FAILED');}
 if(!response.ok)throw new KalshiDemoError('HTTP_'+response.status);
 if(!response.headers.get('content-type')?.toLowerCase().includes('application/json')||!response.body)
  throw new KalshiDemoError('BAD_REPLY');
 let cashMicros:number;
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 try{
  let size=0,text='';
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
   if(size>16384){await reader.cancel();throw new Error('size');}text+=decoder.decode(part.value,{stream:true});}
  const data:unknown=JSON.parse(text+decoder.decode());
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('shape');
  cashMicros=demoFixedMicros((data as Record<string,unknown>).balance_dollars);
  if(cashMicros<0)throw new Error('balance');
 }catch{throw new KalshiDemoError('BAD_REPLY');}
 finally{reader.releaseLock();}
 return {status:'DEMO_CONNECTION_VERIFIED',source:'KALSHI_DEMO',readOnly:true,cashMicros,
  checkedAt:new Date(timestamp).toISOString()};
}
