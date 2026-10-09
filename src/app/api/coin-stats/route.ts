import { NextResponse } from "next/server";
import { getHolderStats } from "@/lib/market";
import { isValidAddress } from "@/lib/solana";

export const dynamic = "force-dynamic";

/** Top-10 holder share and dev's share for one coin, read from Solana (cached 10 min). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const mint = q.get("mint") ?? "";
  const dev = q.get("dev") ?? "";
  if (!isValidAddress(mint) || !isValidAddress(dev)) {
    return NextResponse.json({ error: "bad address" }, { status: 400 });
  }
  try {
    const stats = await Promise.race([
      getHolderStats(mint, dev),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 25_000)),
    ]);
    return NextResponse.json(stats);
  } catch {
    return NextResponse.json({ top10: null, devHold: null });
  }
}
