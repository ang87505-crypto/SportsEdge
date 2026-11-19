import {timingSafeEqual} from 'node:crypto';
/** Constant-time `Authorization: Bearer <token>` check. A missing or empty configured token never matches. */
export function bearerMatches(supplied:string|null|undefined,token:string|null|undefined):boolean{
 if(!token)return false;
 const a=Buffer.from(supplied??'','utf8'),b=Buffer.from('Bearer '+token,'utf8');
 return a.length===b.length&&timingSafeEqual(a,b);
}
