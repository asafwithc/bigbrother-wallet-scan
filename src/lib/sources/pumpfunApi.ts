/**
 * pump.fun frontend API client (frontend-api-v3.pump.fun).
 *
 * The public REST endpoint serves the newest launches with creator wallet
 * and creation timestamp — no RPC calls needed. Two hard limits discovered
 * by probing:
 *   - pages cap at 70 coins regardless of `limit`
 *   - offset pagination only reaches ~1,000 rows deep (~30-60 min of
 *     launches at current rates) — deep enough for catch-up, too shallow
 *     for multi-day backfill
 *
 * Everything is best-effort: the endpoint is unofficial and can disappear,
 * so every failure degrades to "no backfill this cycle".
 */

const API_BASE = process.env.PUMPFUN_API_BASE ?? "https://frontend-api-v3.pump.fun";

const PAGE_SIZE = 70;
const PAGE_DELAY_MS = 2_500; // the API 429s quickly — stay well under its limit
const REQUEST_TIMEOUT_MS = 15_000;

export interface PumpApiCoin {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  created_timestamp: number; // milliseconds
}

export interface NormalizedLaunch {
  mint: string;
  name: string | null;
  symbol: string | null;
  dev: string;
  blockTime: number; // seconds
}

interface RawCoin {
  mint?: unknown;
  name?: unknown;
  symbol?: unknown;
  creator?: unknown;
  created_timestamp?: unknown;
}

function normalize(c: RawCoin): NormalizedLaunch | null {
  if (
    typeof c.mint !== "string" ||
    typeof c.creator !== "string" ||
    typeof c.created_timestamp !== "number"
  ) {
    return null;
  }
  return {
    mint: c.mint,
    name: typeof c.name === "string" && c.name ? c.name : null,
    symbol: typeof c.symbol === "string" && c.symbol ? c.symbol : null,
    dev: c.creator,
    blockTime: Math.floor(c.created_timestamp / 1000),
  };
}

async function fetchPage(offset: number): Promise<RawCoin[]> {
  const url = `${API_BASE}/coins?offset=${offset}&limit=${PAGE_SIZE}&sortBy=creationTime&order=DESC`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as RawCoin[]) : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk the newest launches back `pages` pages (offset order, newest first).
 * Returns them oldest-first, deduped by mint.
 */
export async function fetchRecentLaunches(pages = 15): Promise<NormalizedLaunch[]> {
  const byMint = new Map<string, NormalizedLaunch>();
  for (let page = 0; page < pages; page++) {
    let coins: RawCoin[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        coins = await fetchPage(page * PAGE_SIZE);
        break;
      } catch (err) {
        if (attempt === 1) {
          console.warn(
            `[pumpfun-api] page ${page} failed after retry: ${String(err).slice(0, 100)}`
          );
        } else {
          // 429s need a longer cool-down than plain transient errors
          const wait = String(err).includes("429") ? 8_000 : 2_000;
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }
    if (coins.length === 0) break; // reached the API's reachable depth
    for (const c of coins) {
      const n = normalize(c);
      if (n && !byMint.has(n.mint)) byMint.set(n.mint, n);
    }
    if (coins.length < PAGE_SIZE) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }
  return [...byMint.values()].sort((a, b) => a.blockTime - b.blockTime);
}
