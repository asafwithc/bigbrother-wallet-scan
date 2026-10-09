import { getDb } from "./db";
import { ensureCoinsTable, refreshCoins } from "./market";
import { isValidAddress } from "./solana";
import { tierOf, TIER_STYLE, type Tier } from "./tiers";

/**
 * A coin's "card": the coin, who launched it, how that dev is rated here and
 * what their best coin did. Built from Jupiter's token data plus this app's
 * own records. Served by /api/card; an X bot can post `cardText`.
 */

const JUP_ASSETS_URL = "https://datapi.jup.ag/v1/assets/search";
const DEX_PAIR_URL = "https://api.dexscreener.com/latest/dex/pairs/solana";

export interface CoinCard {
  mint: string;
  name: string | null;
  symbol: string | null;
  icon: string | null;
  launchpad: string | null;
  mcap: number | null;
  fees: number | null; // lifetime fees paid by traders, SOL
  holders: number | null;
  top10: number | null; // % of supply held by the largest wallets
  migrated: boolean;
  dev: string | null;
  devLaunches: number | null; // all-time, from Jupiter
  devMigrations: number | null;
  /** null = this app hasn't rated the dev */
  tier: Tier | null;
  score: number | null;
  best: { mint: string; symbol: string | null; ath: number | null } | null;
}

interface JupAsset {
  id: string;
  name?: string;
  symbol?: string;
  icon?: string;
  dev?: string;
  launchpad?: string;
  mcap?: number;
  fdv?: number;
  fees?: number;
  holderCount?: number;
  graduatedAt?: string;
  graduatedPool?: string;
  audit?: { topHoldersPercentage?: number; devMints?: number; devMigrations?: number };
}

/** Every Solana address in a pasted command, link or sentence, in order. */
export function extractAddresses(text: string): string[] {
  const found = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) ?? [];
  return [...new Set(found)].filter(isValidAddress);
}

async function jupAsset(mint: string): Promise<JupAsset | null> {
  const res = await fetch(`${JUP_ASSETS_URL}?query=${mint}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Jupiter HTTP ${res.status}`);
  const list = (await res.json()) as JupAsset[];
  return (Array.isArray(list) ? list : []).find((a) => a?.id === mint) ?? null;
}

/** A DEX Screener link carries the pool's address, not the coin's. */
async function mintOfPool(pool: string): Promise<string | null> {
  try {
    const res = await fetch(`${DEX_PAIR_URL}/${pool}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { pairs?: { baseToken?: { address?: string } }[] | null };
    return body.pairs?.[0]?.baseToken?.address ?? null;
  } catch {
    return null;
  }
}

export async function getCard(input: string): Promise<{ card: CoinCard } | { error: string }> {
  const addresses = extractAddresses(input);
  if (addresses.length === 0) return { error: "No contract address found in that." };

  let asset: JupAsset | null = null;
  try {
    for (const a of addresses.slice(0, 3)) {
      asset = await jupAsset(a);
      if (!asset) {
        const mint = await mintOfPool(a);
        if (mint) asset = await jupAsset(mint);
      }
      if (asset) break;
    }
  } catch {
    return { error: "Coin data is unavailable right now. Try again in a moment." };
  }
  if (!asset) return { error: "No coin found for that address." };

  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const dev = asset.dev ?? null;
  let tier: Tier | null = null;
  let score: number | null = null;
  let best: CoinCard["best"] = null;
  if (dev) {
    ensureCoinsTable();
    const db = getDb();
    const rated = db
      .prepare("SELECT MAX(dev_verdict) AS verdict, MAX(dev_score) AS risk FROM launches WHERE dev = ?")
      .get(dev) as { verdict: string | null; risk: number | null };
    if (rated.verdict !== null) {
      tier = tierOf(rated.verdict, rated.risk);
      score = Math.round(100 - (rated.risk ?? 50));
    }
    // bring the dev's recorded coins up to date first, so "best coin" uses fresh numbers
    const mints = (
      db
        .prepare("SELECT mint FROM launches WHERE dev = ? GROUP BY mint ORDER BY MAX(block_time) DESC LIMIT 30")
        .all(dev) as { mint: string }[]
    ).map((r) => r.mint);
    await refreshCoins(mints, 10 * 60, 3_000).catch(() => 0);
    const top = db
      .prepare(
        `SELECT l.mint, MAX(l.symbol) AS symbol, c.ath
         FROM launches l JOIN coins c ON c.mint = l.mint
         WHERE l.dev = ? AND c.ath > 0
         GROUP BY l.mint ORDER BY c.ath DESC, c.fees DESC LIMIT 1`
      )
      .get(dev) as { mint: string; symbol: string | null; ath: number | null } | undefined;
    best = top ?? null;
  }

  const devMints = num(asset.audit?.devMints);
  return {
    card: {
      mint: asset.id,
      name: asset.name ?? null,
      symbol: asset.symbol ?? null,
      icon: asset.icon ?? null,
      launchpad: asset.launchpad ?? null,
      mcap: num(asset.mcap) ?? num(asset.fdv),
      fees: num(asset.fees),
      holders: num(asset.holderCount),
      top10: num(asset.audit?.topHoldersPercentage),
      migrated: !!(asset.graduatedAt || asset.graduatedPool),
      dev,
      devLaunches: devMints,
      // Jupiter leaves this out when the dev has no migrations
      devMigrations: num(asset.audit?.devMigrations) ?? (devMints !== null ? 0 : null),
      tier,
      score,
      best,
    },
  };
}

const usd = (n: number | null) =>
  n === null ? "?" : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${Math.round(n)}`;
const shortAddr = (a: string) => `${a.slice(0, 5)}…${a.slice(-5)}`;

/** The card as plain text, short enough for a reply on X. */
export function cardText(c: CoinCard): string {
  const lines = [
    `$${c.symbol ?? "?"}${c.name ? ` (${c.name})` : ""} · mcap ${usd(c.mcap)} · ${c.migrated ? "migrated" : "on the curve"}`,
  ];
  if (c.dev) {
    const rating = c.tier ? `${TIER_STYLE[c.tier].label}, score ${c.score}` : "not rated yet";
    lines.push(`Dev ${shortAddr(c.dev)}: ${rating}`);
    if (c.devLaunches !== null) {
      lines.push(`${c.devLaunches} launch${c.devLaunches === 1 ? "" : "es"}, ${c.devMigrations ?? 0} migrated`);
    }
  }
  if (c.best && c.best.mint !== c.mint) lines.push(`Best coin: $${c.best.symbol ?? "?"} (${usd(c.best.ath)} ATH)`);
  return lines.join("\n");
}
