type Target={startsAt:string;home:string;away:string};
type Obj=Record<string,unknown>;
function obj(x:unknown):Obj{return x&&typeof x==='object'?x as Obj:{};}
export function verifiedFinal(raw:unknown,target:Target):{homeScore:number;awayScore:number}|null {
 const root=obj(raw);if(!Array.isArray(root.events))throw new Error('Invalid scoreboard response');
 const finals=[];
 for(const value of root.events){const e=obj(value),season=obj(e.season);
  if(season.type!==2||typeof e.date!=='string'||Date.parse(e.date)!==Date.parse(target.startsAt)||!Array.isArray(e.competitions))continue;
  for(const value of e.competitions){const c=obj(value),status=obj(obj(c.status).type);
   if(status.completed!==true||status.name!=='STATUS_FINAL'||!Array.isArray(c.competitors)||c.competitors.length!==2)continue;
   const h=c.competitors.map(obj).find(x=>x.homeAway==='home'),a=c.competitors.map(obj).find(x=>x.homeAway==='away');
   if(!h||!a||obj(h.team).displayName!==target.home||obj(a.team).displayName!==target.away)continue;
   if(typeof h.score!=='string'||typeof a.score!=='string'||!/^\d+$/.test(h.score)||!/^\d+$/.test(a.score))throw new Error('Invalid final score');
   const hs=Number(h.score),aws=Number(a.score);if(!Number.isSafeInteger(hs)||!Number.isSafeInteger(aws)||hs===aws)throw new Error('Invalid final NBA score');
   finals.push({homeScore:hs,awayScore:aws});
  }
 }
 if(finals.length>1)throw new Error('Ambiguous result match');return finals[0]??null;
}
