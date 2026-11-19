/**
 * Research discovery foundation (INACTIVE: no scheduler, no network in this module). Builds polite requests for
 * free scholarly sources, parses their responses into leads, treats every external string as untrusted DATA, and
 * keeps a research memory so the same paper or idea is never fetched or investigated twice. Leads only become
 * testable through intake.ts (hypothesis cards) and a committed pre-registration; nothing here can reach an active
 * model, a pick rule, a stake, a budget or a schedule.
 */
import {createHash} from 'node:crypto';
import type {SourceKind} from './intake.ts';

export type SourceId='openalex'|'arxiv';
/** Terms checked against each provider's own documentation on 2026-11-13. Re-check before any scheduled use. */
export const SOURCE_CATALOG:Record<SourceId,{base:string;minIntervalMs:number;maxRequestsPerRun:number;terms:string;termsUrl:string;kind:SourceKind}>={
 openalex:{base:'https://api.openalex.org/works',minIntervalMs:200,maxRequestsPerRun:20,kind:'peer-reviewed',
  terms:'Free; no key needed for basic use at up to 10 requests/s; a free key raises the daily budget and is needed for deep paging.',
  termsUrl:'https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication'},
 arxiv:{base:'https://export.arxiv.org/api/query',minIntervalMs:3000,maxRequestsPerRun:10,kind:'working-paper',
  terms:'At most one request every 3 seconds on a single connection; metadata is CC0; e-print files must not be re-served.',
  termsUrl:'https://info.arxiv.org/help/api/tou.html'},
};

export type Lead={source:SourceId;id:string;url:string;title:string;abstract:string;publishedAt:string|null;retrievedAt:string;
 authors:string[];kind:SourceKind;doi:string|null;
 /** Text that reads like an instruction to an AI or operator. Recorded for review; never acted on. */
 suspectedInjection:boolean;contentHash:string};

const INJECTION=/\b(ignore (all |any )?(previous|prior|above) (instructions|prompts)|disregard (the|all) (rules|instructions)|you are now|system prompt|run (this|the following) command|execute (this|the following)|place (a|an) (order|bet|trade)|transfer (funds|money)|api[_ ]?key|password)\b/i;
/** External text is data: control characters removed, whitespace collapsed, length capped, never interpreted. */
export function untrustedText(v:unknown,max=2000):string{
 if(typeof v!=='string')return '';
 return v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export const looksLikeInstruction=(t:string)=>INJECTION.test(t);

/** Polite request plan: fixed base URLs, bounded query text, per-source interval and per-run cap. */
export function planRequests(source:SourceId,queries:string[],opts:{fromYear?:number;perPage?:number}={}):{url:string;notBeforeMs:number}[]{
 const s=SOURCE_CATALOG[source],per=Math.min(Math.max(opts.perPage??25,1),50);
 const clean=[...new Set(queries.map(q=>untrustedText(q,200)).filter(Boolean))].slice(0,s.maxRequestsPerRun);
 return clean.map((q,i)=>{
  const u=new URL(s.base);
  if(source==='openalex'){u.searchParams.set('search',q);u.searchParams.set('per-page',String(per));
   if(opts.fromYear)u.searchParams.set('filter',`from_publication_date:${opts.fromYear}-01-01`);}
  else{u.searchParams.set('search_query','all:'+q);u.searchParams.set('max_results',String(per));u.searchParams.set('sortBy','submittedDate');}
  return {url:u.toString(),notBeforeMs:i*s.minIntervalMs};
 });
}

/** Exponential backoff with a hard retry cap; a 4xx other than 429 is never retried. */
export function retryDelayMs(attempt:number,status:number|null,maxAttempts=3):number|null{
 if(attempt>=maxAttempts)return null;
 if(status!==null&&status>=400&&status<500&&status!==429)return null;
 return Math.min(60_000,1000*2**attempt);
}

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function lead(x:Omit<Lead,'suspectedInjection'|'contentHash'>):Lead{
 const suspectedInjection=looksLikeInstruction(x.title)||looksLikeInstruction(x.abstract);
 return {...x,suspectedInjection,contentHash:hash([x.source,x.id,x.title,x.abstract].join('|'))};
}

/** OpenAlex /works response. The abstract arrives as an inverted index; it is rebuilt in word order. */
export function parseOpenAlex(body:unknown,retrievedAt:string):Lead[]{
 const results=(body as {results?:unknown})?.results;
 if(!Array.isArray(results))return [];
 return results.slice(0,200).flatMap(r=>{
  const w=r as Record<string,unknown>;
  const id=untrustedText(w.id,200);
  if(!/^https:\/\/openalex\.org\/W\d+$/.test(id))return [];
  const inv=w.abstract_inverted_index as Record<string,number[]>|null|undefined;
  const words:string[]=[];
  if(inv&&typeof inv==='object')for(const [word,pos] of Object.entries(inv))if(Array.isArray(pos))for(const p of pos)if(Number.isInteger(p)&&p>=0&&p<5000)words[p]=word;
  const doi=typeof w.doi==='string'&&/^https:\/\/doi\.org\/10\./.test(w.doi)?w.doi.toLowerCase():null;
  const authors=Array.isArray(w.authorships)?w.authorships.slice(0,20).map(a=>untrustedText((a as {author?:{display_name?:string}})?.author?.display_name,120)).filter(Boolean):[];
  return [lead({source:'openalex',id,url:doi??id,title:untrustedText(w.title??w.display_name,400),abstract:untrustedText(words.filter(Boolean).join(' ')),
   publishedAt:typeof w.publication_date==='string'&&/^\d{4}-\d\d-\d\d$/.test(w.publication_date)?w.publication_date:null,retrievedAt,authors,
   kind:w.type==='preprint'?'working-paper':'peer-reviewed',doi})];
 });
}

/** arXiv Atom feed. A minimal, strict reader: only <entry> blocks with an arXiv abs id are kept. */
export function parseArxiv(xml:string,retrievedAt:string):Lead[]{
 if(typeof xml!=='string'||xml.length>5_000_000)return [];
 const tag=(s:string,t:string)=>{const m=new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(s);return m?m[1]:'';};
 const decode=(s:string)=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
 return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0,200).flatMap(([,e])=>{
  const id=decode(tag(e,'id')).trim();
  if(!/^https?:\/\/arxiv\.org\/abs\/[\w.\/-]+$/.test(id))return [];
  const authors=[...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)].slice(0,20).map(m=>untrustedText(decode(m[1]),120));
  const published=decode(tag(e,'published')).trim();
  return [lead({source:'arxiv',id:id.replace(/^http:/,'https:'),url:id.replace(/^http:/,'https:'),title:untrustedText(decode(tag(e,'title')),400),
   abstract:untrustedText(decode(tag(e,'summary'))),publishedAt:/^\d{4}-\d\d-\d\d/.test(published)?published.slice(0,10):null,retrievedAt,authors,
   kind:'working-paper',doi:null})];
 });
}

/**
 * Research memory (append-only records, e.g. a JSONL file on the research-data branch). A lead is new only if
 * neither its DOI, its source id nor its normalized title has been seen. Status changes are new records, never edits.
 */
export type MemoryRecord={key:string;leadId:string;title:string;status:'discovered'|'carded'|'preregistered'|'tested'|'accepted'|'rejected'|'duplicate';
 at:string;reason:string|null;hypothesisKey:string|null};
export const titleKey=(t:string)=>hash(t.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()).slice(0,24);
export function memoryKeys(l:Pick<Lead,'doi'|'id'|'title'>){return [l.doi?'doi:'+l.doi:null,'id:'+l.id,'title:'+titleKey(l.title)].filter((x):x is string=>!!x);}
export function newLeads(leads:Lead[],memory:MemoryRecord[]):{fresh:Lead[];duplicates:Lead[]}{
 const seen=new Set(memory.map(m=>m.key));const fresh:Lead[]=[],duplicates:Lead[]=[];
 for(const l of leads){const ks=memoryKeys(l);if(ks.some(k=>seen.has(k)))duplicates.push(l);else{fresh.push(l);ks.forEach(k=>seen.add(k));}}
 return {fresh,duplicates};
}
/** The latest status for each lead id (records are appended in time order). */
export function currentStatus(memory:MemoryRecord[]):Map<string,MemoryRecord>{
 const out=new Map<string,MemoryRecord>();
 for(const m of [...memory].sort((a,b)=>a.at.localeCompare(b.at)))out.set(m.leadId,m);
 return out;
}
