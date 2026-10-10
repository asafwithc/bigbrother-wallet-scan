import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { isValidAddress } from "@/lib/solana";

export const dynamic = "force-dynamic";

/**
 * The project's own coin for the navbar ticker. Set in .env:
 *   TOKEN_MINT=<the coin's contract address>
 *   TOKEN_SYMBOL=FADE        (optional: taken from the coin's own data if left out)
 * With no TOKEN_MINT the ticker is simply not shown.
 */
async function load() {
  const mint = (process.env.TOKEN_MINT ?? "").trim();
  if (!isValidAddress(mint)) return { token: null };
  let symbol = (process.env.TOKEN_SYMBOL ?? "").trim().replace(/^\$/, "") || null;
  let mcap: number | null = null;
  try {
    const res = await fetch(`https://datapi.jup.ag/v1/assets/search?query=${mint}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      const list = (await res.json()) as { id: string; symbol?: string; mcap?: number; fdv?: number }[];
      const a = (Array.isArray(list) ? list : []).find((x) => x?.id === mint);
      if (a) {
        symbol = symbol ?? a.symbol ?? null;
        mcap = typeof a.mcap === "number" ? a.mcap : typeof a.fdv === "number" ? a.fdv : null;
      }
    }
  } catch {
    /* show the ticker without a number */
  }
  return { token: { mint, symbol: symbol ?? "TOKEN", mcap } };
}

export async function GET() {
  return NextResponse.json(await cached("token", 20_000, load));
}
