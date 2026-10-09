import { NextResponse } from "next/server";
import { get_feed, get_launches_page } from "@/lib/db";
import { ensureMonitorStarted, getMonitorStatuses } from "@/lib/monitor";
import { ensureCalloutPicks } from "@/lib/callouts";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const page = Math.max(1, Number(q.get("page")) || 1);
  const filter = q.get("filter") ?? undefined;
  const launchpad = q.get("launchpad") ?? undefined;
  // every open tab polls this; they share one computation per 2 seconds
  return NextResponse.json(
    await cached(`feed|${filter ?? ""}|${launchpad ?? ""}|${page}`, 2_000, () => build(page, filter, launchpad))
  );
}

function build(page: number, filter: string | undefined, launchpad: string | undefined) {
  // keeps the callout picks current (and their tables in place) for the Called filter
  ensureCalloutPicks();
  const { launches, total } = get_launches_page({
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    filter,
    launchpad,
  });
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
  return {
    events,
    launches,
    total,
    page,
    pageSize: PAGE_SIZE,
    monitors: getMonitorStatuses(),
  };
}
