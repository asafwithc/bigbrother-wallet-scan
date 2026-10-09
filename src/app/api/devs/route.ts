import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tierSql } from "@/lib/tiers";
import { ensureCoinsTable, refreshCoins } from "@/lib/market";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const COINS_PER_DEV = 30;
const WINDOWS: Record<string, number> = { "24h": 86400, "7d": 7 * 86400, "3m": 90 * 86400 };

const TIERS: Record<string, string> = tierSql("verdict", "risk");
const SORTS: Record<string, string> = {
  score: "risk ASC, launches DESC",
  launches: "launches DESC, risk ASC",
  recent: "last_launch DESC",
};

interface DevCoin {
  mint: string;
  symbol: string | null;
  name: string | null;
  ath: number | null;
  fees: number | null;
  migrated: number;
}

/** The dev's standout coin (highest market cap seen, then most fees) and whether the newest one migrated. */
function summarize(coins: DevCoin[]) {
  const best = coins.reduce<DevCoin | null>((a, c) => {
    if (!a) return c;
    const byAth = (c.ath ?? 0) - (a.ath ?? 0);
    return byAth > 0 || (byAth === 0 && (c.fees ?? 0) > (a.fees ?? 0)) ? c : a;
  }, null);
  return {
    best: best && ((best.ath ?? 0) > 0 || (best.fees ?? 0) > 0) ? best : null,
    lastMigrated: coins[0]?.migrated === 1,
    recordedMigrated: coins.filter((c) => c.migrated).length,
  };
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const tier = TIERS[q.get("tier") ?? "top"] ? (q.get("tier") ?? "top") : "top";
  const sort = SORTS[q.get("sort") ?? "score"] ?? SORTS.score;
  const since = Math.floor(Date.now() / 1000) - (WINDOWS[q.get("window") ?? "7d"] ?? WINDOWS["7d"]);
  const page = Math.max(1, Number(q.get("page")) || 1);
  ensureCoinsTable();
  const db = getDb();

  // `launches` is the dev's all-time mint count from Jupiter when we have it
  // (our own monitor only records part of what launches), else what we recorded.
  const base = `
    WITH d AS (
      SELECT l.dev,
             MAX(COALESCE(MAX(c.dev_mints), 0), COUNT(DISTINCT l.mint)) AS launches,
             MAX(c.dev_migrations) AS dev_migrations,
             MAX(l.block_time) AS last_launch,
             MAX(l.dev_verdict) AS verdict,
             COALESCE(MAX(l.dev_score), 50) AS risk
      FROM launches l LEFT JOIN coins c ON c.mint = l.mint
      GROUP BY l.dev HAVING MAX(l.block_time) >= ?
    )`;

  const counts: Record<string, number> = {};
  for (const [k, cond] of Object.entries(TIERS)) {
    counts[k] = (db.prepare(`${base} SELECT COUNT(*) AS n FROM d WHERE ${cond}`).get(since) as { n: number }).n;
  }

  const devsSql = `${base} SELECT * FROM d WHERE ${TIERS[tier]} ORDER BY ${sort} LIMIT ? OFFSET ?`;
  const args = [since, PAGE_SIZE, (page - 1) * PAGE_SIZE];
  type DevRow = {
    dev: string;
    launches: number;
    dev_migrations: number | null;
    last_launch: number;
    verdict: string | null;
    risk: number;
  };
  let devs = db.prepare(devsSql).all(...args) as DevRow[];

  // Bring this page's coins up to date from Jupiter (fees, migrations, dev totals),
  // then read the page again so it reflects the fresh numbers.
  const mintStmt = db.prepare(
    "SELECT mint FROM launches WHERE dev = ? GROUP BY mint ORDER BY MAX(block_time) DESC LIMIT ?"
  );
  const mints = devs.flatMap((d) => (mintStmt.all(d.dev, COINS_PER_DEV) as { mint: string }[]).map((r) => r.mint));
  if ((await refreshCoins(mints, 10 * 60, 6_000)) > 0) devs = db.prepare(devsSql).all(...args) as DevRow[];

  // newest coin first
  const coinStmt = db.prepare(
    `SELECT l.mint, MAX(l.symbol) AS symbol, MAX(l.name) AS name, c.ath, c.fees, COALESCE(c.migrated, 0) AS migrated
     FROM launches l LEFT JOIN coins c ON c.mint = l.mint
     WHERE l.dev = ? GROUP BY l.mint ORDER BY MAX(l.block_time) DESC LIMIT ?`
  );
  return NextResponse.json({
    counts,
    total: counts[tier],
    page,
    pageSize: PAGE_SIZE,
    devs: devs.map((d) => {
      const s = summarize(coinStmt.all(d.dev, COINS_PER_DEV) as DevCoin[]);
      return {
        dev: d.dev,
        launches: d.launches,
        // all-time migrations from Jupiter when known, else the ones we recorded
        migratedCount: Math.max(d.dev_migrations ?? 0, s.recordedMigrated),
        lastLaunch: d.last_launch,
        lastMigrated: s.lastMigrated,
        verdict: d.verdict,
        risk: d.risk,
        score: Math.round(100 - d.risk), // reputation: higher = better
        best: s.best,
      };
    }),
  });
}
