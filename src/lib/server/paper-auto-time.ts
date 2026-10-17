/** New York session time helpers for the recurring PAPER controller. Pure functions. */
const NY='America/New_York';
const PARTS=new Intl.DateTimeFormat('en-US',{timeZone:NY,hourCycle:'h23',year:'numeric',
 month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});

function nyParts(ms:number){
 const p=PARTS.formatToParts(new Date(ms));
 const part=(t:string)=>Number(p.find(x=>x.type===t)?.value);
 return {year:part('year'),month:part('month'),day:part('day'),
  hour:part('hour'),minute:part('minute'),second:part('second')};
}
/** New York calendar date (YYYY-MM-DD) of an instant. */
export function nyDate(ms:number):string{
 if(!Number.isFinite(ms))throw Error('INVALID_TIME');
 const p=nyParts(ms);
 return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
/** Minutes after New York midnight. */
export function nyMinutes(ms:number):number{
 const p=nyParts(ms);
 return p.hour*60+p.minute;
}
function offsetMs(utcMs:number){
 const p=nyParts(utcMs);
 return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(utcMs/1000)*1000;
}
/** UTC instant of a New York wall-clock time; session times never fall in a DST gap. */
export function nyLocalToUtcMs(date:string,time:string):number{
 const d=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date),t=/^(\d{2}):(\d{2})$/.exec(time);
 if(!d||!t)throw Error('INVALID_SESSION_TIME');
 const local=Date.UTC(Number(d[1]),Number(d[2])-1,Number(d[3]),Number(t[1]),Number(t[2]));
 let utc=local-offsetMs(local);
 utc=local-offsetMs(utc);
 if(nyDate(utc)!==date)throw Error('INVALID_SESSION_TIME');
 return utc;
}
/** Scheduler slot: the UTC quarter hour containing the instant, e.g. 2026-11-02T14:45Z. */
export function quarterHourSlot(ms:number):string{
 if(!Number.isFinite(ms))throw Error('INVALID_TIME');
 const floored=Math.floor(ms/900_000)*900_000;
 return new Date(floored).toISOString().slice(0,16)+'Z';
}
export function iso(ms:number):string{
 if(!Number.isFinite(ms))throw Error('INVALID_TIME');
 return new Date(ms).toISOString();
}
