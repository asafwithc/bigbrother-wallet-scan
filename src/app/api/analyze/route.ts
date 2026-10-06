import { NextRequest, NextResponse } from "next/server";
import { analyzeWallet } from "@/lib/analysis/analyze";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("wallet")?.trim() ?? "";
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  if (!address) {
    return NextResponse.json({ error: "Missing ?wallet=<address>" }, { status: 400 });
  }
  try {
    const report = await analyzeWallet(address, refresh);
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("Invalid") ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
