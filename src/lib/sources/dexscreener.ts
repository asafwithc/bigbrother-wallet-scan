/**
 * DexScreener public API client (free, no key).
 * https://docs.dexscreener.com/api/reference
 * Rate limit: 300 req/min for token endpoints — we throttle to be safe.
 */

const BASE = "https://api.dexscreener.com/latest/dex";

const MIN_INTERVAL_MS = 250;
let lastCall = 0;

async function throttle(): Promise<void> {
  const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export interface DexPairStats {
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  priceChange24h: number | null;
  pairCreatedAt: number | null; // ms
  dexId: string | null;
  url: string | null;
}

interface RawPair {
  chainId: string;
  dexId: string;
  url: string;
  pairCreatedAt?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceUsd?: string;
  priceChange?: { h24?: number };
}

export async function getTokenPairStats(
  mint: string
): Promise<DexPairStats | null> {
  await throttle();
  const res = await fetch(`${BASE}/tokens/${mint}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.warn(`[dexscreener] ${mint} -> HTTP ${res.status}`);
    return null;
  }
  const json = (await res.json()) as { pairs?: RawPair[] | null };
  const pairs = (json.pairs ?? []).filter((p) => p.chainId === "solana");
  if (pairs.length === 0) return null;

  // Prefer the deepest-liquidity pair (main market for the token)
  const best = pairs.reduce((a, b) =>
    (b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a
  );

  return {
    liquidityUsd: best.liquidity?.usd ?? null,
    volume24hUsd: best.volume?.h24 ?? null,
    priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
    priceChange24h: best.priceChange?.h24 ?? null,
    pairCreatedAt: best.pairCreatedAt ?? null,
    dexId: best.dexId ?? null,
    url: best.url ?? null,
  };
}
