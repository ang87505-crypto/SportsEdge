import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectSelectedTracks } from "@/lib/server/collect/odds-collector";
import {parseCollectionChoice,collectionTracks,describeCollection} from "@/lib/ingestion/collection-policy";
import { checkIngestionDatabase } from "@/lib/server/collect/readiness";

/**
 * Server-only collection trigger. There is NO public mutation API and no
 * automatic schedule until the owner configures credentials and approves cron.
 */
export async function GET(request: Request) {
  const expected = process.env.SPORTSEDGE_INGEST_TOKEN;
  const supplied = request.headers.get("authorization") ?? "";
  const wanted = expected ? `Bearer ${expected}` : "";
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(wanted, "utf8");
  if (!expected || expected.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Not found" }, {
      status: 404, headers: { "Cache-Control": "private, no-store" },
    });
  }
  const options=new URL(request.url).searchParams;
  let choice:ReturnType<typeof parseCollectionChoice>;
  try{choice=parseCollectionChoice(options.get('track'));}
  catch{return NextResponse.json({error:'Choose track=nba, track=soccer, or track=both'},{
   status:400,headers:{'Cache-Control':'private, no-store'}
  });}
  // Provider-free dry run: requires the same private token, but uses zero API credits.
  if(options.get('plan')==='1')return NextResponse.json({
   status:'planned',...describeCollection(choice)
  },{headers:{'Cache-Control':'private, no-store'}});
  if(!process.env.SUPABASE_URL ||
     !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)){
    return NextResponse.json({status:'not_configured'},{
     status:503,headers:{'Cache-Control':'private, no-store'}
    });
  }
  try {
    if(options.get('probe')==='1'){
      // Database verification ONLY: no source API calls and no rows written.
      const result=await checkIngestionDatabase();
      return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
    }
    // Never turn a link prefetch, accidental URL visit or stale script into
    // an unapproved billable sportsbook-data request.
    if(options.get('collect')!=='1')
      return NextResponse.json({
       error:'No collection performed. First use plan=1, then collect=1 explicitly.'
      },{status:400,headers:{'Cache-Control':'private, no-store'}});
    if(!process.env.ODDS_API_KEY)
      return NextResponse.json({status:'not_configured'},{
       status:503,headers:{'Cache-Control':'private, no-store'}
      });
    const report=await collectSelectedTracks(collectionTracks(choice));
    return NextResponse.json(report,{headers:{'Cache-Control':'private, no-store'}});
  } catch (error) {
    // Never leak provider request URLs (which contain API keys) or DB credentials.
    console.error("[SportsEdge] private dual-track ingest failure:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ status: "collection_failed" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
