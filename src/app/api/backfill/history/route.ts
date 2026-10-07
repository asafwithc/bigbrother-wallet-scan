import { NextResponse } from "next/server";
import { runHistoryBackfill } from "@/lib/historyBackfill";

export const dynamic = "force-dynamic";

/**
 * POST /api/backfill/history — manually trigger the Bitquery historical
 * daily-count import. Useful right after adding BITQUERY_API_KEY to .env:
 *   curl -X POST http://localhost:3000/api/backfill/history
 */
export async function POST() {
  const result = await runHistoryBackfill(true);
  return NextResponse.json(result);
}

export async function GET() {
  return POST();
}
