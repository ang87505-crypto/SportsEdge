import {cachedMoneylineHealth} from '@/lib/server/moneyline-health';
/** Public aggregate status only. Request parameters cannot choose a project, run, RPC or provider. */
export async function GET(){
 await connection();
 return Response.json(await cachedMoneylineHealth(new Date().toISOString(),process.env),{
  headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
import {connection} from 'next/server';
