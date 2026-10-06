import { NextRequest, NextResponse } from "next/server";
import { add_watch, remove_watch, get_watchlist } from "@/lib/db";
import { isValidAddress } from "@/lib/solana";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ watchlist: get_watchlist() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    address?: string;
    label?: string;
  };
  const address = body.address?.trim() ?? "";
  if (!isValidAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  add_watch(address, body.label);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!address) {
    return NextResponse.json({ error: "Missing address" }, { status: 400 });
  }
  remove_watch(address);
  return NextResponse.json({ ok: true });
}
