/**
 * Safety brake: pause picking when recent results are confidently below break-even, not merely
 * unlucky. Pure. The brake only ever pauses a RUNNING control; it never resumes anything.
 */
export const BRAKE_WINDOW=150;
export const BRAKE_MIN=50;
/** Two-pick Power Play break-even: p² × 3 = 1. */
export const BREAK_EVEN=0.577;

export function wilsonUpper(k:number,n:number,z=1.96):number{
 if(n<=0)return 1;
 const p=k/n,z2=z*z;
 return (p+z2/(2*n)+z*Math.sqrt(p*(1-p)/n+z2/(4*n*n)))/(1+z2/n);
}

export function safetyBrake(picks:{key:string;correct:boolean;gradedAt:string}[],control:string|null)
 :{trip:boolean;n:number;hitRate:number|null;upper:number|null}{
 const unique=new Map<string,{correct:boolean;gradedAt:string}>();
 for(const p of picks)if(!unique.has(p.key))unique.set(p.key,p);
 const recent=[...unique.values()].sort((a,b)=>b.gradedAt.localeCompare(a.gradedAt)).slice(0,BRAKE_WINDOW);
 const n=recent.length;
 if(!n)return {trip:false,n:0,hitRate:null,upper:null};
 const k=recent.filter(p=>p.correct).length;
 const upper=wilsonUpper(k,n);
 return {trip:control==='RUNNING'&&n>=BRAKE_MIN&&upper<BREAK_EVEN,n,hitRate:k/n,upper};
}
