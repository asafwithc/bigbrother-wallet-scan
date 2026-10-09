import { NextResponse } from "next/server";
import { regradeStaleDevs } from "@/lib/analysis/lite";
import { requeueRepeatDevs } from "@/lib/monitor";

export const dynamic = "force-dynamic";

/**
 * Re-grade devs after a grading change: instantly grade every 2+ coin dev
 * that is unchecked or "Unknown", then queue all 2+ coin devs for a full check.
 */
export async function POST() {
  return NextResponse.json({ regraded: regradeStaleDevs(), queued: requeueRepeatDevs() });
}
