/** Shared, side-effect-free display formatters. Missing or invalid inputs render as an em dash, never as zero. */
const usdFormat=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const usdWhole=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});

export const DASH='—';

export function usdCents(cents:number|null|undefined,{whole=false,signed=false}:{whole?:boolean;signed?:boolean}={}){
 if(cents===null||cents===undefined||!Number.isFinite(cents))return DASH;
 const text=(whole?usdWhole:usdFormat).format(Math.abs(cents)/100);
 if(cents<0)return '−'+text;
 return signed&&cents>0?'+'+text:text;
}

export function usdString(value:string|null|undefined){
 const n=Number(value);
 return value===null||value===undefined||value===''||!Number.isFinite(n)?DASH:usdCents(Math.round(n*100));
}

export function pct(fraction:number|null|undefined,digits=1,{signed=false}:{signed?:boolean}={}){
 if(fraction===null||fraction===undefined||!Number.isFinite(fraction))return DASH;
 const v=fraction*100;
 const text=Math.abs(v).toFixed(digits)+'%';
 if(v<0&&Number(text.slice(0,-1))!==0)return '−'+text;
 return signed&&v>0?'+'+text:text;
}

/** Percentage-point difference between two probabilities. */
export function pp(delta:number|null|undefined,digits=1){
 if(delta===null||delta===undefined||!Number.isFinite(delta))return DASH;
 const v=delta*100;
 const text=Math.abs(v).toFixed(digits)+' pp';
 return v>0?'+'+text:v<0?'−'+text:text;
}

export function american(odds:number|null|undefined){
 if(odds===null||odds===undefined||!Number.isFinite(odds))return DASH;
 return odds>0?`+${odds}`:`−${Math.abs(odds)}`;
}

export function validDate(stamp:string|null|undefined){
 if(!stamp)return null;
 const t=Date.parse(stamp);
 return Number.isFinite(t)?new Date(t):null;
}

export function dateTime(stamp:string|null|undefined,opts:Intl.DateTimeFormatOptions={dateStyle:'medium',timeStyle:'short'}){
 const d=validDate(stamp);
 return d?d.toLocaleString('en-US',opts):DASH;
}

export function dateTimeUtc(stamp:string|null|undefined){
 const d=validDate(stamp);
 return d?d.toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC':DASH;
}

export function shortDate(stamp:string|null|undefined){
 const d=validDate(stamp);
 return d?d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):DASH;
}

/** Human age such as "3 h ago". `now` is passed in so callers control render timing. */
export function age(stamp:string|null|undefined,now:number){
 const d=validDate(stamp);
 if(!d)return DASH;
 const minutes=Math.round((now-d.getTime())/60000);
 if(minutes<-1)return 'in '+relative(-minutes);
 if(minutes<1)return 'just now';
 return relative(minutes)+' ago';
}
function relative(minutes:number){
 if(minutes<60)return `${minutes} min`;
 const hours=Math.round(minutes/60);
 if(hours<48)return `${hours} h`;
 return `${Math.round(hours/24)} d`;
}

export function ageHours(stamp:string|null|undefined,now:number){
 const d=validDate(stamp);
 return d?(now-d.getTime())/3600000:null;
}
