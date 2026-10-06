import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface CoinMeta {
  mcap: number | null;
  image: string | null;
}

// mcap only grows for ATH tracking; keep a small in-memory cache
const cache = new Map<string, { at: number; meta: CoinMeta }>();
const ath = new Map<string, number>();
const TTL_MS = 20_000;

export async function GET(req: Request) {
  const mints = (new URL(req.url).searchParams.get("mints") ?? "")
    .split(",")
    .filter((m) => m.length >= 32)
    .slice(0, 60);

  const now = Date.now();
  const out: Record<string, CoinMeta & { ath: number | null }> = {};
  const stale: string[] = [];
  for (const m of mints) {
    const c = cache.get(m);
    if (c && now - c.at < TTL_MS) out[m] = { ...c.meta, ath: ath.get(m) ?? null };
    else stale.push(m);
  }

  for (let i = 0; i < stale.length; i += 30) {
    const chunk = stale.slice(i, i + 30);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`,
        { cache: "no-store" }
      );
      const pairs = (await res.json()) as {
        baseToken: { address: string };
        marketCap?: number;
        fdv?: number;
        liquidity?: { usd?: number };
        info?: { imageUrl?: string };
      }[];
      const best = new Map<string, (typeof pairs)[number]>();
      for (const p of pairs ?? []) {
        const cur = best.get(p.baseToken.address);
        if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0))
          best.set(p.baseToken.address, p);
      }
      for (const m of chunk) {
        const p = best.get(m);
        const mcap = p?.marketCap ?? p?.fdv ?? null;
        const meta: CoinMeta = {
          mcap,
          image: p?.info?.imageUrl ?? null,
        };
        if (mcap !== null) ath.set(m, Math.max(ath.get(m) ?? 0, mcap));
        cache.set(m, { at: now, meta });
        out[m] = { ...meta, ath: ath.get(m) ?? null };
      }
    } catch {
      /* best-effort */
    }
  }
  return NextResponse.json({ coins: out });
}
