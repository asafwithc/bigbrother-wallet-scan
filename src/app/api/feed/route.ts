import { NextResponse } from "next/server";
import { get_feed, get_launches } from "@/lib/db";
import { ensureMonitorStarted, getMonitorStatuses } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  // self-healing: make sure the background monitor is running
  ensureMonitorStarted();
  const rows = get_feed(50);
  const events = rows.map((r) => ({
    id: r.id,
    address: r.address,
    kind: r.kind,
    message: r.message,
    score: r.score,
    verdict: r.verdict,
    createdAt: r.created_at,
  }));
  return NextResponse.json({
    events,
    launches: get_launches(60),
    monitors: getMonitorStatuses(),
  });
}
