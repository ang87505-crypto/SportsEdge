/** Owner-only browser session for viewing Alpaca PAPER balances.
 * Do not reuse the diagnostic bearer or Alpaca keys as a browser login.
 * A dedicated 64-character random hex secret must be set in Vercel.
 */
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';

export const OWNER_COOKIE='__Host-sportsedge-alpaca-owner';
export const OWNER_SESSION_SECONDS=30*60;
const MAX_SESSION_MS=OWNER_SESSION_SECONDS*1000;

export function ownerSecret():string|null {
  const value=process.env.SPORTSEDGE_ALPACA_DASHBOARD_OWNER_KEY;
  return typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value)?value:null;
}
export function secureTextEquals(a:string,b:string):boolean {
  const left=Buffer.from(a),right=Buffer.from(b);
  return left.length===right.length&&timingSafeEqual(left,right);
}
function signature(secret:string,message:string) {
  return createHmac('sha256',secret).update('sportsedge-alpaca-owner-v1\0').update(message).digest('hex');
}
export function issueOwnerSession(secret:string,now=Date.now()):string {
  const expires=now+MAX_SESSION_MS;
  const message=`v1.${expires}.${randomBytes(16).toString('hex')}`;
  return `${message}.${signature(secret,message)}`;
}
export function validOwnerSession(value:string|null|undefined,secret:string,now=Date.now()):boolean {
  const match=/^v1\.(\d{13})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(value??'');
  if(!match)return false;
  const expiry=Number(match[1]);
  if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+MAX_SESSION_MS)return false;
  const message=`v1.${match[1]}.${match[2]}`;
  return secureTextEquals(match[3],signature(secret,message));
}
