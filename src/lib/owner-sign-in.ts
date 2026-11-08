/** Client-safe owner sign-in feedback. Never stores or logs a key. */
export function ownerKeyInput(value:string):string|null{
 const key=value.trim();
 return /^[a-f0-9]{64}$/i.test(key)?key:null;
}
export const OWNER_KEY_HINT='Paste the full 64-character SportsEdge owner key saved in Vercel.';
export function ownerSignInError(status:number,reason?:unknown):string{
 if(status===401)return 'That owner key does not match this site. Use the current SportsEdge owner key saved in Vercel.';
 if(status===503&&reason==='missing')return 'Owner sign-in is unavailable: this deployment is missing its owner key.';
 if(status===503&&reason==='malformed')return 'Owner sign-in is unavailable: the configured owner key must contain exactly 64 hexadecimal characters.';
 if(status===403)return 'Sign-in was blocked by the site origin check. Reload this SportsEdge page and try again.';
 return 'Owner sign-in is temporarily unavailable. Please try again.';
}
