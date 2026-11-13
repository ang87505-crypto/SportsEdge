/**
 * Calendar-day rest (AI 2.0 research finding, 2026-11-13). The learning layer's restDays in src/lib/props/features.ts
 * is floor((lock − previous)/24 h) − 1, which depends on tip times: one full day off with a tip 30 minutes earlier
 * (≈47.5 h) yields 0 and is flagged back-to-back. NBA rest is a calendar notion, so this counts whole days off between
 * the two game dates in New York time. Research only: the frozen production feature is not changed here; a fix is
 * proposed for owner review after the Monday release.
 */
const ET=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const etDay=(iso:string)=>Date.parse(ET.format(new Date(iso))+'T00:00:00Z')/86400_000;

/** Whole calendar days off between the previous game and this one (0 = back-to-back), capped; null when unknown. */
export function calendarRestDays(previousIso:string|null|undefined,lockIso:string,cap=4):number|null{
 if(!previousIso||!Number.isFinite(Date.parse(previousIso))||!Number.isFinite(Date.parse(lockIso)))return null;
 if(Date.parse(previousIso)>=Date.parse(lockIso))return null;   // never a game at or after lock
 return Math.min(cap,Math.max(0,etDay(lockIso)-etDay(previousIso)-1));
}

/** The current learning-layer definition, reproduced for comparison only. */
export function elapsedRestDays(previousIso:string,lockIso:string,cap=4):number{
 return Math.min(cap,Math.max(0,Math.floor((Date.parse(lockIso)-Date.parse(previousIso))/86400_000)-1));
}
