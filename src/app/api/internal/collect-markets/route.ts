import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { collectDualTracks } from "@/lib/server/collect/odds-collector";
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
  if (!process.env.ODDS_API_KEY || !process.env.SUPABASE_URL ||
      !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    return NextResponse.json({ status: "not_configured" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
  try {
    // Authenticated, read-only probe. No Odds API usage or DB writes.
    if (new URL(request.url).searchParams.get("probe") === "1") {
      const result = await checkIngestionDatabase();
      return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
    }
    const report = await collectDualTracks();
    return NextResponse.json(report, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // Never leak provider request URLs (which contain API keys) or DB credentials.
    console.error("[SportsEdge] private dual-track ingest failure:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ status: "collection_failed" }, {
      status: 503, headers: { "Cache-Control": "private, no-store" },
    });
  }
}
