import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getDb } from "./db";
import { rpc, bondingCurveAddress } from "./solana";

/**
 * Per-coin market + holder facts, stored in the `coins` table.
 *
 *  - A background scan asks Jupiter's token data API about every coin launched
 *    in the last 48h, 100 per request: market cap, 24h volume, graduation,
 *    lifetime fees, holder count, top-holder and dev share, and the dev's
 *    all-time mints and migrations. Pages that show older coins refresh just
 *    those coins on demand (refreshCoins).
 *  - ATH is the highest market cap this app has seen, not the true all-time
 *    high.
 *  - DexScreener is the fallback when Jupiter can't be reached. It is not the
 *    first choice because it sometimes reports absurd market caps for new
 *    Token-2022 coins (e.g. $196M for a coin Jupiter values at $4.8K).
 *  - Holder shares can also be read from Solana on demand (getHolderStats) for
 *    coins Jupiter has no audit data for; the public RPC is slow and refuses
 *    the top-holder call most of the time.
 */

const SCAN_EVERY_MS = 3 * 60_000;
const SCAN_WINDOW_S = 48 * 3600;
const HOLDER_TTL_S = 10 * 60;

const JUP_ASSETS_URL = "https://datapi.jup.ag/v1/assets/search";
const JUP_BATCH = 100;
// An ATH above this many USD per SOL of lifetime fees is a data glitch, not a
// run: real runners sit around $5K-$45K of peak market cap per SOL of fees.
const MAX_ATH_PER_FEE_SOL = 500_000;

let tableReady = false;
export function ensureCoinsTable(): void {
  if (tableReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS coins (
      mint TEXT PRIMARY KEY,
      mcap REAL,
      ath REAL,
      volume24h REAL,
      migrated INTEGER NOT NULL DEFAULT 0,
      migrated_at INTEGER,
      market_at INTEGER,
      top10 REAL,
      dev_hold REAL,
      holders_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_coins_migrated ON coins(migrated, migrated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_launches_symbol ON launches(symbol COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_launches_mint ON launches(mint);
  `);
  const cols = (getDb().pragma("table_info(coins)") as { name: string }[]).map((c) => c.name);
  const add = (name: string, type: string) => {
    if (!cols.includes(name)) getDb().exec(`ALTER TABLE coins ADD COLUMN ${name} ${type}`);
  };
  add("fees", "REAL"); // lifetime fees paid by traders, in SOL (Jupiter)
  add("holders", "INTEGER");
  add("dev_mints", "INTEGER"); // the dev's all-time mints / migrations (Jupiter)
  add("dev_migrations", "INTEGER");
  add("jup_at", "INTEGER"); // unix seconds of the last Jupiter update
  tableReady = true;
}

interface DexPair {
  baseToken: { address: string };
  dexId?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
}

interface JupAsset {
  id: string;
  mcap?: number;
  fdv?: number;
  fees?: number;
  holderCount?: number;
  graduatedAt?: string;
  graduatedPool?: string;
  stats24h?: { buyVolume?: number; sellVolume?: number };
  audit?: {
    topHoldersPercentage?: number;
    devBalancePercentage?: number;
    devMints?: number;
    devMigrations?: number;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Update up to 100 coins from Jupiter. Returns how many it knew, or null if
 * the request failed (so the caller can fall back to DexScreener).
 */
async function updateFromJupiter(mints: string[], now: number): Promise<number | null> {
  let assets: JupAsset[];
  try {
    const res = await fetch(`${JUP_ASSETS_URL}?query=${mints.join(",")}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    assets = (await res.json()) as JupAsset[];
    if (!Array.isArray(assets)) return null;
  } catch {
    return null;
  }

  const upsert = getDb().prepare(
    `INSERT INTO coins (mint, mcap, ath, volume24h, migrated, migrated_at, market_at,
                        top10, dev_hold, holders_at, fees, holders, dev_mints, dev_migrations, jup_at)
     VALUES (@mint, @mcap, @mcap, @volume, @migrated,
             CASE WHEN @migrated = 1 THEN COALESCE(@gradAt, @now) END, @now,
             @top10, @devHold, @holdersAt, @fees, @holders, @devMints, @devMigrations, @now)
     ON CONFLICT(mint) DO UPDATE SET
       mcap = @mcap,
       ath = CASE
         WHEN @fees IS NOT NULL
              AND COALESCE(ath, 0) > @fees * ${MAX_ATH_PER_FEE_SOL}
              AND COALESCE(ath, 0) > 20 * COALESCE(@mcap, 0)
           THEN @mcap  -- stored ATH was a glitch: start again from the real value
         ELSE MAX(COALESCE(ath, 0), COALESCE(@mcap, 0))
       END,
       volume24h = @volume,
       migrated_at = CASE WHEN @migrated = 1 THEN COALESCE(@gradAt, migrated_at, @now) ELSE migrated_at END,
       migrated = MAX(migrated, @migrated),
       market_at = @now,
       top10 = COALESCE(@top10, top10),
       dev_hold = COALESCE(@devHold, dev_hold),
       holders_at = COALESCE(@holdersAt, holders_at),
       fees = COALESCE(@fees, fees),
       holders = COALESCE(@holders, holders),
       dev_mints = COALESCE(@devMints, dev_mints),
       dev_migrations = COALESCE(@devMigrations, dev_migrations),
       jup_at = @now`
  );
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const wanted = new Set(mints);
  let n = 0;
  for (const a of assets) {
    if (!a || !wanted.has(a.id)) continue;
    const migrated = a.graduatedAt || a.graduatedPool ? 1 : 0;
    const gradMs = a.graduatedAt ? Date.parse(a.graduatedAt) : NaN;
    const top10 = num(a.audit?.topHoldersPercentage);
    const devHold = num(a.audit?.devBalancePercentage);
    upsert.run({
      mint: a.id,
      mcap: num(a.mcap) ?? num(a.fdv),
      volume: (a.stats24h?.buyVolume ?? 0) + (a.stats24h?.sellVolume ?? 0),
      migrated,
      gradAt: migrated && Number.isFinite(gradMs) ? Math.floor(gradMs / 1000) : null,
      now,
      top10,
      devHold,
      holdersAt: top10 !== null || devHold !== null ? now : null,
      fees: num(a.fees),
      holders: num(a.holderCount),
      devMints: num(a.audit?.devMints),
      // Jupiter leaves this out when the dev has no migrations
      devMigrations: num(a.audit?.devMigrations) ?? (num(a.audit?.devMints) !== null ? 0 : null),
    });
    wanted.delete(a.id);
    n++;
  }
  // coins Jupiter doesn't know: remember that we asked, so they aren't retried on every page load
  const asked = getDb().prepare(
    "INSERT INTO coins (mint, jup_at) VALUES (?, ?) ON CONFLICT(mint) DO UPDATE SET jup_at = excluded.jup_at"
  );
  for (const mint of wanted) asked.run(mint, now);
  return n;
}

/** DexScreener fallback: market cap, volume and migration only, 30 coins per request. */
async function updateFromDex(mints: string[], now: number): Promise<number> {
  const upsert = getDb().prepare(
    `INSERT INTO coins (mint, mcap, ath, volume24h, migrated, migrated_at, market_at)
     VALUES (@mint, @mcap, @mcap, @volume, @migrated, CASE WHEN @migrated = 1 THEN @now END, @now)
     ON CONFLICT(mint) DO UPDATE SET
       mcap = @mcap,
       ath = MAX(COALESCE(ath, 0), COALESCE(@mcap, 0)),
       volume24h = @volume,
       migrated_at = CASE WHEN migrated = 0 AND @migrated = 1 THEN @now ELSE migrated_at END,
       migrated = MAX(migrated, @migrated),
       market_at = @now`
  );
  let updated = 0;
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const pairs = (await res.json()) as DexPair[];
      const byMint = new Map<string, DexPair[]>();
      for (const p of pairs ?? []) {
        const list = byMint.get(p.baseToken.address) ?? [];
        list.push(p);
        byMint.set(p.baseToken.address, list);
      }
      for (const mint of chunk) {
        const list = byMint.get(mint);
        if (!list) continue; // DexScreener doesn't know this coin (yet)
        const best = list.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
        // on a real DEX pool (pumpswap, raydium, …) = completed the bonding curve
        const migrated = list.some((p) => !!p.dexId && p.dexId !== "pumpfun") ? 1 : 0;
        upsert.run({
          mint,
          mcap: best.marketCap ?? best.fdv ?? null,
          volume: list.reduce((t, p) => t + (p.volume?.h24 ?? 0), 0),
          migrated,
          now,
        });
        updated++;
      }
    } catch {
      /* next chunk */
    }
    await sleep(300); // stay well under 300 req/min
  }
  return updated;
}

/** Update a list of coins, Jupiter first. Stops early when `deadlineMs` passes. */
async function updateCoins(mints: string[], deadlineMs = Infinity): Promise<number> {
  ensureCoinsTable();
  let updated = 0;
  for (let i = 0; i < mints.length && Date.now() < deadlineMs; i += JUP_BATCH) {
    const chunk = mints.slice(i, i + JUP_BATCH);
    const now = Math.floor(Date.now() / 1000);
    const n = await updateFromJupiter(chunk, now);
    updated += n ?? (await updateFromDex(chunk, now));
    if (i + JUP_BATCH < mints.length) await sleep(250);
  }
  return updated;
}

let scanning = false;
export async function scanMarket(windowS = SCAN_WINDOW_S): Promise<number> {
  if (scanning) return 0;
  scanning = true;
  ensureCoinsTable();
  try {
    const now = Math.floor(Date.now() / 1000);
    const mints = (
      getDb()
        .prepare(
          "SELECT mint FROM launches WHERE block_time >= ? GROUP BY mint ORDER BY MAX(block_time) DESC"
        )
        .all(now - windowS) as { mint: string }[]
    ).map((r) => r.mint);
    return await updateCoins(mints);
  } finally {
    scanning = false;
  }
}

/**
 * Make sure these coins have Jupiter data no older than `maxAgeS`, spending at
 * most `budgetMs`. For pages that show coins the background scan no longer covers.
 */
export async function refreshCoins(mints: string[], maxAgeS: number, budgetMs: number): Promise<number> {
  ensureCoinsTable();
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeS;
  const unique = [...new Set(mints)];
  const fresh = new Set<string>();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const rows = db
      .prepare(
        `SELECT mint FROM coins WHERE jup_at >= ? AND mint IN (${chunk.map(() => "?").join(",")})`
      )
      .all(cutoff, ...chunk) as { mint: string }[];
    for (const r of rows) fresh.add(r.mint);
  }
  const stale = unique.filter((m) => !fresh.has(m));
  if (stale.length === 0) return 0;
  return updateCoins(stale, Date.now() + budgetMs);
}

/** Idempotent — started from instrumentation and lazily from the terminal API. */
export function ensureMarketScan(): void {
  const g = globalThis as unknown as { __bbMarketScanStarted?: boolean };
  if (g.__bbMarketScanStarted) return;
  g.__bbMarketScanStarted = true;
  ensureCoinsTable();
  const run = () =>
    void scanMarket().then((n) => {
      if (n > 0) console.log(`[market] refreshed ${n} coin(s)`);
    });
  setTimeout(run, 2_000);
  setInterval(run, SCAN_EVERY_MS);
  // brand-new coins get their first price quickly; skipped while a full scan runs
  setInterval(() => void scanMarket(15 * 60), 20_000);
}

/* ----------------------------- holder stats ------------------------------ */

export interface HolderStats {
  top10: number | null; // % of supply held by the 10 largest wallets
  devHold: number | null; // % of supply held by the dev
}

const inflight = new Map<string, Promise<HolderStats>>();
let largestBlockedUntil = 0;

export function getHolderStats(mint: string, dev: string): Promise<HolderStats> {
  ensureCoinsTable();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare("SELECT top10, dev_hold, holders_at, migrated FROM coins WHERE mint = ?")
    .get(mint) as
    | { top10: number | null; dev_hold: number | null; holders_at: number | null; migrated: number }
    | undefined;
  if (row?.holders_at && now - row.holders_at < HOLDER_TTL_S) {
    return Promise.resolve({ top10: row.top10, devHold: row.dev_hold });
  }
  const running = inflight.get(mint);
  if (running) return running;

  const job = (async (): Promise<HolderStats> => {
    const mintPk = new PublicKey(mint);
    const curvePk = await bondingCurveAddress(mintPk);
    const curveAta = getAssociatedTokenAddressSync(mintPk, curvePk, true).toBase58();
    // The free public RPC refuses getTokenLargestAccounts most of the time
    // ("too many requests for a specific RPC call"). Give it a short window and,
    // after a failure, stop asking for a while so it can't hold up the rest.
    const largestCall =
      Date.now() < largestBlockedUntil
        ? Promise.resolve(null)
        : Promise.race([
            rpc.getTokenLargestAccounts(mintPk),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("slow")), 6_000)),
          ]).catch(() => {
            largestBlockedUntil = Date.now() + 5 * 60_000;
            return null;
          });
    const [supplyRes, largest, devAccounts] = await Promise.all([
      rpc.getTokenSupply(mintPk).catch(() => null),
      largestCall,
      rpc.getTokenAccountsByOwner(new PublicKey(dev), mintPk).catch(() => null),
    ]);
    const supply = supplyRes?.value.uiAmount ?? 0;
    let top10: number | null = null;
    let devHold: number | null = null;
    if (supply > 0 && largest) {
      // The bonding curve's own account isn't a holder. After migration the
      // single largest account is the liquidity pool, so that one is skipped too.
      let holders = largest.value.filter((a) => a.address.toBase58() !== curveAta);
      if (row?.migrated) holders = holders.slice(1);
      top10 =
        (holders.slice(0, 10).reduce((s, a) => s + (a.uiAmount ?? 0), 0) / supply) * 100;
    }
    if (supply > 0 && devAccounts) {
      const amt = devAccounts.value.reduce(
        (s, a) =>
          s +
          ((a.account.data.parsed as { info?: { tokenAmount?: { uiAmount?: number } } })?.info
            ?.tokenAmount?.uiAmount ?? 0),
        0
      );
      devHold = (amt / supply) * 100;
    }
    if (top10 !== null || devHold !== null) {
      db.prepare(
        `INSERT INTO coins (mint, top10, dev_hold, holders_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(mint) DO UPDATE SET top10 = excluded.top10, dev_hold = excluded.dev_hold, holders_at = excluded.holders_at`
      ).run(mint, top10, devHold, Math.floor(Date.now() / 1000));
    }
    return { top10, devHold };
  })().finally(() => inflight.delete(mint));

  inflight.set(mint, job);
  return job;
}
