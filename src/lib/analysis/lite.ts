import { PublicKey } from "@solana/web3.js";
import { rpc } from "../solana";
import { getDb } from "../db";

/**
 * Fast dev check for the live feed.
 *
 * The full wallet analysis needs dozens of RPC calls, which the free public
 * endpoint can't serve in time (every check timed out, so no dev was ever
 * scored). This one uses the launches we've already recorded for the dev plus
 * ONE batched DexScreener call and at most one RPC call, and finishes in a
 * couple of seconds. The full report is still available on /wallet/<address>.
 */

export type LiteVerdict = "Legit" | "Suspicious" | "Likely Rugged" | "Unknown";

export interface LiteResult {
  score: number; // 0..100, higher = riskier
  verdict: LiteVerdict;
  reason: string;
}

export interface PriorToken {
  graduated: boolean;
  dead: boolean;
  mcap: number; // current market cap in USD (0 = no market)
}

export interface LiteFacts {
  prior: PriorToken[]; // dev's other launches we know about
  launchesPerDay: number; // launch rate over the period we've watched this dev
  totalCoins: number; // every coin we've seen from this dev, including the newest
  maxPerHour: number; // most coins launched inside a single hour
  txCount: number | null; // up to 100 recent signatures
  activeSpanDays: number | null; // time covered by those signatures
}

const clamp = (n: number) => Math.max(1, Math.min(99, Math.round(n)));

/**
 * Pure decision logic (unit tested). Builds a 1..99 reputation from the
 * dev's track record, then stores it as risk = 100 - reputation.
 *
 *   start at 50
 *   + graduated coins: +18 for the first, +12 for each extra (max +45)
 *   + coins with traction (not graduated, $10K+ market cap): +10 each (max +30)
 *   + success rate (graduated or traction): up to +8
 *   + best earlier coin's market cap: +3 ($50K) / +6 ($250K) / +10 ($1M) / +14 ($5M)
 *   - share of earlier coins that are dead: up to -15
 *   - serial launching with no success: -10 (4+ coins) / -20 (8+ coins)
 *   - launch spam: -5 (>5 a day) / -12 (>15 a day)
 *   - mass launching with no success: -12 (5+ coins) / -25 (10+ coins)
 *   - burst launching (3+ coins inside one hour): -10
 *   - bot-like wallet (100+ txs in under 3 days): -4
 *
 * "Unknown" is only for devs with a single launch on record. With 2+ coins a
 * dev is graded: at least one win and reputation 50+ is a good dev or better,
 * everyone else is a farmer (the reputation says how bad).
 */
export function decide(f: LiteFacts): LiteResult {
  const n = f.prior.length;
  const grad = f.prior.filter((p) => p.graduated).length;
  const traction = f.prior.filter((p) => !p.graduated && p.mcap >= 10_000).length;
  const wins = grad + traction;
  const dead = f.prior.filter((p) => p.dead).length;
  const best = Math.max(0, ...f.prior.map((p) => p.mcap));
  const botLike =
    f.txCount !== null && f.txCount >= 100 && f.activeSpanDays !== null && f.activeSpanDays < 3;

  let rep = 50;
  const why: string[] = [];
  if (grad > 0) {
    rep += Math.min(45, 18 + (grad - 1) * 12);
    why.push(`${grad} of ${n} earlier coin(s) graduated`);
  }
  if (traction > 0) {
    rep += Math.min(30, traction * 10);
    why.push(`${traction} earlier coin(s) with traction`);
  }
  if (wins > 0) rep += (wins / n) * 8;
  if (best >= 50_000) {
    rep += best >= 5e6 ? 14 : best >= 1e6 ? 10 : best >= 250_000 ? 6 : 3;
    why.push(`best earlier coin at $${Math.round(best / 1000)}K`);
  }
  if (n > 0 && dead > 0) {
    rep -= (dead / n) * 15;
    why.push(`${dead} of ${n} earlier coin(s) dead`);
  }
  const serial = wins === 0 && n >= 4 && dead / n >= 0.75;
  if (serial) {
    rep -= n >= 8 ? 20 : 10;
    why.push("serial launcher, nothing took off");
  }
  const spam = f.launchesPerDay > 15;
  if (f.launchesPerDay > 5) {
    rep -= spam ? 12 : 5;
    why.push(`${f.launchesPerDay.toFixed(1)} launches a day`);
  }
  const mass = wins === 0 && f.totalCoins >= 5;
  if (mass) {
    rep -= f.totalCoins >= 10 ? 25 : 12;
    why.push(`${f.totalCoins} coins launched, nothing took off`);
  }
  const burst = f.maxPerHour >= 3;
  if (burst) {
    rep -= 10;
    why.push(`${f.maxPerHour} coins launched within an hour`);
  }
  if (botLike) {
    rep -= 4;
    why.push("bot-like wallet activity");
  }
  rep = clamp(rep);

  // Unknown means exactly one thing: we've only ever seen a single launch
  // from this dev. Anyone with 2+ coins gets a real grade.
  let verdict: LiteVerdict;
  if (f.totalCoins <= 1) verdict = "Unknown";
  else if (wins >= 1 && rep >= 50) verdict = "Legit";
  else if ((serial && n >= 8) || (mass && f.totalCoins >= 10)) verdict = "Likely Rugged";
  else verdict = "Suspicious";

  return {
    score: 100 - rep,
    verdict,
    reason: why.length ? why.join("; ") : "no track record yet",
  };
}

interface DexPair {
  baseToken: { address: string };
  dexId?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
}

async function classifyPrior(mints: string[]): Promise<Map<string, PriorToken>> {
  const out = new Map<string, PriorToken>();
  const best = new Map<string, DexPair>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    try {
      const res = await fetch(
        `https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) continue;
      for (const p of (await res.json()) as DexPair[]) {
        const cur = best.get(p.baseToken.address);
        if (!cur || (p.liquidity?.usd ?? 0) > (cur.liquidity?.usd ?? 0))
          best.set(p.baseToken.address, p);
      }
    } catch {
      /* treated as no data below */
    }
  }
  for (const m of mints) {
    const p = best.get(m);
    const mcap = p?.marketCap ?? p?.fdv ?? 0;
    const graduated =
      !!p && !!p.dexId && p.dexId !== "pumpfun" && (p.liquidity?.usd ?? 0) >= 3000;
    out.set(m, { graduated, dead: !graduated && mcap < 3000, mcap });
  }
  return out;
}

export async function liteAnalyzeDev(
  dev: string,
  currentMint: string | null
): Promise<LiteResult> {
  const rows = getDb()
    .prepare(
      "SELECT DISTINCT mint FROM launches WHERE dev = ? AND mint != ? AND block_time < strftime('%s','now') - 1800 ORDER BY block_time DESC LIMIT 30"
    )
    .all(dev, currentMint ?? "") as { mint: string }[];
  const mints = rows.map((r) => r.mint);
  const priorMap = mints.length > 0 ? await classifyPrior(mints) : new Map();

  let txCount: number | null = null;
  let activeSpanDays: number | null = null;
  try {
    const sigs = await Promise.race([
      rpc.getSignaturesForAddress(new PublicKey(dev), { limit: 100 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("rpc timeout")), 5_000)),
    ]);
    txCount = sigs.length;
    const times = sigs.map((s) => s.blockTime).filter((t): t is number => !!t);
    if (times.length > 1) activeSpanDays = (Math.max(...times) - Math.min(...times)) / 86400;
  } catch {
    /* wallet history is optional */
  }

  const span = getDb()
    .prepare(
      "SELECT COUNT(DISTINCT mint) AS n, MIN(block_time) AS first, MAX(block_time) AS last FROM launches WHERE dev = ?"
    )
    .get(dev) as { n: number; first: number | null; last: number | null };
  // rate over at least one day, so two quick launches don't read as spam
  const days = Math.max(1, ((span.last ?? 0) - (span.first ?? 0)) / 86400);
  const launchesPerDay = span.n / days;

  const hour = getDb()
    .prepare(
      "SELECT MAX(c) AS m FROM (SELECT COUNT(DISTINCT mint) AS c FROM launches WHERE dev = ? GROUP BY block_time / 3600)"
    )
    .get(dev) as { m: number | null };

  return decide({
    prior: [...priorMap.values()],
    launchesPerDay,
    totalCoins: span.n,
    maxPerHour: hour.m ?? 0,
    txCount,
    activeSpanDays,
  });
}

/**
 * Instant grade from our own launch records only (no network). Used so a dev
 * with 2+ coins is never left showing as unknown while the full check, which
 * also looks at how the earlier coins are doing, waits in the queue.
 * Returns null for single-launch devs (they are genuinely Unknown).
 */
export function provisionalGrade(dev: string): LiteResult | null {
  const db = getDb();
  const span = db
    .prepare(
      "SELECT COUNT(DISTINCT mint) AS n, MIN(block_time) AS first, MAX(block_time) AS last FROM launches WHERE dev = ?"
    )
    .get(dev) as { n: number; first: number | null; last: number | null };
  if (span.n < 2) return null;
  const hour = db
    .prepare(
      "SELECT MAX(c) AS m FROM (SELECT COUNT(DISTINCT mint) AS c FROM launches WHERE dev = ? GROUP BY block_time / 3600)"
    )
    .get(dev) as { m: number | null };
  const days = Math.max(1, ((span.last ?? 0) - (span.first ?? 0)) / 86400);
  return decide({
    prior: [],
    launchesPerDay: span.n / days,
    totalCoins: span.n,
    maxPerHour: hour.m ?? 0,
    txCount: null,
    activeSpanDays: null,
  });
}

/** Give every 2+ coin dev that is unchecked or still "Unknown" an instant grade. */
export function regradeStaleDevs(): number {
  const db = getDb();
  const devs = db
    .prepare(
      "SELECT dev FROM launches GROUP BY dev HAVING COUNT(DISTINCT mint) >= 2 AND (MAX(dev_verdict) IS NULL OR MAX(dev_verdict) = 'Unknown')"
    )
    .all() as { dev: string }[];
  const upd = db.prepare("UPDATE launches SET dev_score = ?, dev_verdict = ? WHERE dev = ?");
  // single-launch devs graded under older rules go back to Unknown
  let n = db
    .prepare(
      `UPDATE launches SET dev_score = 50, dev_verdict = 'Unknown'
       WHERE dev_verdict IN ('Suspicious','Likely Rugged')
         AND dev IN (SELECT dev FROM launches GROUP BY dev HAVING COUNT(DISTINCT mint) = 1)`
    )
    .run().changes;
  for (const { dev } of devs) {
    const r = provisionalGrade(dev);
    if (!r) continue;
    upd.run(r.score, r.verdict, dev);
    n++;
  }
  return n;
}
