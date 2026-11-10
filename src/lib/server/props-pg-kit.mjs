// TEST-ONLY: a PostgREST-subset fetch shim backed by a disposable local PostgreSQL
// database (psql as service_role), so the real propsStore, triggers and RPCs are
// exercised end to end. Never used in production. Requires root + local PostgreSQL.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const lit=v=>{
 if(v===null||v===undefined)return 'NULL';
 if(Array.isArray(v))return `'{${v.map(x=>String(x).replace(/[{}",\\']/g,'')).join(',')}}'`;
 if(typeof v==='object')return `'${JSON.stringify(v).replace(/'/g,"''")}'`;
 return `'${String(v).replace(/'/g,"''")}'`;
};
const ident=s=>{if(!/^[a-z_][a-z0-9_]*$/.test(s))throw new Error('bad identifier '+s);return s;};

export function psql(db,sql){
 const r=spawnSync('su',['postgres','-c',`psql -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d ${db}`],{input:sql,encoding:'utf8',maxBuffer:64<<20});
 return {ok:r.status===0,out:r.stdout.trim(),err:r.stderr};
}
export function resetDb(db,files){
 spawnSync('su',['postgres','-c',`dropdb --if-exists ${db}`]);
 const c=spawnSync('su',['postgres','-c',`createdb ${db}`]);
 if(c.status!==0)throw new Error('createdb failed');
 for(const f of files){const r=psql(db,readFileSync(f,'utf8'));if(!r.ok)throw new Error('schema load failed: '+r.err.slice(0,400));}
}
export const testClockSql=`
CREATE OR REPLACE FUNCTION public.props_now() RETURNS timestamptz LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT coalesce(nullif(current_setting('props_test.now',true),'')::timestamptz,clock_timestamp()) $$;
GRANT EXECUTE ON FUNCTION public.props_now() TO service_role;
ALTER ROLE service_role BYPASSRLS;
-- Test-only: the v1 policy row is stamped with the real load time; backdate it so pinned test clocks see it.
ALTER TABLE public.props_budget_policy DISABLE TRIGGER props_append_only;
UPDATE public.props_budget_policy SET active_from='2026-01-01T00:00:00Z' WHERE version='props-budget-v1';
ALTER TABLE public.props_budget_policy ENABLE TRIGGER props_append_only;
`;

function filters(params){
 const where=[];
 for(const [k,raw] of params){
  if(['select','order','limit','offset','on_conflict'].includes(k))continue;
  const col=ident(k);
  const m=/^(not\.)?(eq|gt|gte|lt|lte|in|is)\.(.*)$/s.exec(raw);if(!m)throw new Error('unsupported filter '+raw);
  const [,neg,op,val]=m;let expr;
  if(op==='is'){if(val!=='null')throw new Error('is only null');expr=`${col} IS NULL`;}
  else if(op==='in'){const items=val.replace(/^\(|\)$/g,'').split(',').filter(Boolean).map(x=>x.replace(/^"|"$/g,''));
   expr=items.length?`${col}::text IN (${items.map(lit).join(',')})`:'false';}
  else expr=`${col} ${{eq:'=',gt:'>',gte:'>=',lt:'<',lte:'<='}[op]} ${lit(val)}`;
  where.push(neg?`NOT (${expr})`:expr);
 }
 return where.length?' WHERE '+where.join(' AND '):'';
}

export function pgFetch(db,clock){
 return async (input,init={})=>{
  const url=new URL(String(input));
  const path=url.pathname.replace(/^\/rest\/v1\//,'');
  const prefix=`SET ROLE service_role; SELECT set_config('props_test.now',${lit(clock())},false) \\g /dev/null\n`;
  let sql;
  if(path.startsWith('rpc/')){
   const fn=ident(path.slice(4));const args=JSON.parse(init.body);
   sql=`SELECT to_json(public.${fn}(${Object.entries(args).map(([k,v])=>`${ident(k)}=>${lit(v)}`).join(',')}));`;
  }else if(init.method==='POST'){
   const t=ident(path);const rows=JSON.parse(init.body);const cols=Object.keys(rows[0]).map(ident);
   const oc=url.searchParams.get('on_conflict');const sel=url.searchParams.get('select');
   const prefer=new Headers(init.headers).get('Prefer')??'';
   const tag='$j'+Math.random().toString(36).slice(2,8)+'$';
   sql=`WITH ins AS (INSERT INTO public.${t}(${cols.join(',')}) SELECT ${cols.join(',')} FROM jsonb_populate_recordset(NULL::public.${t},${tag}${JSON.stringify(rows)}${tag}::jsonb)`+
    (prefer.includes('ignore-duplicates')?` ON CONFLICT (${oc.split(',').map(ident).join(',')}) DO NOTHING`:'')+
    ` RETURNING ${sel?sel.split(',').map(ident).join(','):'1 AS x'}) SELECT coalesce(json_agg(ins),'[]') FROM ins;`;
   if(!sel)sql=sql.replace(/SELECT coalesce\(json_agg\(ins\),'\[\]'\) FROM ins;$/,"SELECT '' FROM (SELECT count(*) FROM ins) z;");
  }else{
   const t=ident(path);const sel=url.searchParams.get('select')??'*';
   const order=url.searchParams.get('order');const limit=url.searchParams.get('limit');const offset=url.searchParams.get('offset');
   sql=`SELECT coalesce(json_agg(q),'[]') FROM (SELECT ${sel.split(',').map(ident).join(',')} FROM public.${t}${filters([...url.searchParams])}`+
    (order?' ORDER BY '+order.split(',').map(o=>{const [c,dir]=o.split('.');return ident(c)+(dir==='desc'?' DESC':' ASC');}).join(','):'')+
    (limit?' LIMIT '+Number(limit):'')+(offset?' OFFSET '+Number(offset):'')+') q;';
  }
  const r=psql(db,prefix+sql);
  if(!r.ok){
   const m=/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(r.err)??/ERROR:\s+(.*)/.exec(r.err);
   const body=m&&m.length===3?{code:m[1],message:m[2]}:{message:(m?.[1]??r.err).slice(0,300)};
   return new Response(JSON.stringify(body),{status:400,headers:{'Content-Type':'application/json'}});
  }
  return new Response(r.out,{status:init.method==='POST'&&!path.startsWith('rpc/')?201:200,headers:{'Content-Type':'application/json'}});
 };
}
