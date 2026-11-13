import { NextResponse } from "next/server";
import { isSupabaseConfigured, readSportsConnection } from "@/lib/server/supabase-admin";
import { bearerMatches } from "@/lib/server/bearer";

export async function GET(request: Request) {
  // Keep privileged health checks inaccessible to anonymous internet visitors.
  if (!bearerMatches(request.headers.get("authorization"), process.env.SPORTSEDGE_HEALTH_TOKEN)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ status: "not_configured" }, { status: 503 });
  }
  try {
    const result = await readSportsConnection();
    return NextResponse.json({ status: "connected", sportsCount: result.sportsCount }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "connection_failed" }, { status: 503 });
  }
}
