import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCoinsTable, ensureMarketScan } from "@/lib/market";
import { ensureMonitorStarted } from "@/lib/monitor";
import { ensureCalloutPicks } from "@/lib/callouts";
import { cached } from "@/lib/cache";

export const dynamic = "force-dynamic";

const LIMIT = 40;

/**
 * Rows for one column. `pick` is a query returning the mints to show (already
 * limited), so the per-coin lookups below only run for those few coins rather
 * than for every coin in the time window. One row per coin: the monitor can
 * record a mint more than once.
 */
const rowsFor = (pick: string, orderBy: string) => `
  SELECT l.mint, l.name, l.symbol, l.launchpad, l.dev, l.bt AS blockTime,
         l.v AS devVerdict, l.s AS devScore,
         c.mcap, c.ath, c.volume24h AS volume, COALESCE(c.migrated, 0) AS migrated,
         c.top10, c.dev_hold AS devHold,
         (SELECT COUNT(DISTINCT mint) FROM launches d WHERE d.dev = l.dev) AS devCoins,
         EXISTS (
           SELECT 1 FROM launches o
           WHERE o.symbol = l.symbol COLLATE NOCASE AND o.mint != l.mint AND o.block_time < l.bt
         ) AS copycat
  FROM (
    SELECT la.mint, MIN(la.block_time) AS bt, MAX(la.name) AS name, MAX(la.symbol) AS symbol,
           MAX(la.launchpad) AS launchpad, MAX(la.dev) AS dev,
           MAX(la.dev_verdict) AS v, MAX(la.dev_score) AS s
    FROM (${pick}) p JOIN launches la ON la.mint = p.mint
    GROUP BY la.mint
  ) l
  LEFT JOIN coins c ON c.mint = l.mint
  ORDER BY ${orderBy}
  LIMIT ${LIMIT}`;

const NEWEST = rowsFor(
  "SELECT mint FROM launches WHERE block_time >= ? GROUP BY mint ORDER BY MIN(block_time) DESC LIMIT ?",
  "l.bt DESC"
);
// live (not migrated) coins from Crazy / Proven / Good devs, biggest first
const TOP_DEVS = rowsFor(
  `SELECT la.mint FROM launches la LEFT JOIN coins c ON c.mint = la.mint
   WHERE la.block_time >= ? AND la.dev_verdict = 'Legit' AND COALESCE(c.migrated, 0) = 0
   GROUP BY la.mint ORDER BY COALESCE(MAX(c.mcap), 0) DESC, MIN(la.block_time) DESC LIMIT ?`,
  "COALESCE(c.mcap, 0) DESC, l.bt DESC"
);
const MIGRATED = rowsFor(
  "SELECT mint FROM coins WHERE migrated = 1 ORDER BY migrated_at DESC LIMIT ?",
  "c.migrated_at DESC, l.bt DESC"
);
const CALLOUTS = rowsFor(
  "SELECT mint FROM callouts ORDER BY picked_at DESC, slot DESC LIMIT ?",
  "l.bt DESC"
);

function build() {
  ensureMonitorStarted();
  ensureCoinsTable();
  ensureMarketScan();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const day = now - 86400;
  ensureCalloutPicks(now);

  const one = (sql: string, ...a: number[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  return {
    stats: {
      launches24h: one("SELECT COUNT(DISTINCT mint) AS n FROM launches WHERE block_time >= ?", day),
      totalLaunches: one("SELECT COUNT(DISTINCT mint) AS n FROM launches"),
      devs: one("SELECT COUNT(DISTINCT dev) AS n FROM launches"),
      migrated: one("SELECT COUNT(*) AS n FROM coins WHERE migrated = 1"),
      callouts: one("SELECT COUNT(*) AS n FROM callouts"),
    },
    newLaunches: db.prepare(NEWEST).all(now - 3 * 3600, LIMIT),
    topDevCoins: db.prepare(TOP_DEVS).all(day, LIMIT),
    // a few extra picked, in case a coin row has no launch row to join to
    migrated: db.prepare(MIGRATED).all(LIMIT + 10),
    callouts: db.prepare(CALLOUTS).all(LIMIT + 10),
  };
}

// Every open Terminal polls this every 6 seconds; they share one computation per 3.
export async function GET() {
  return NextResponse.json(await cached("terminal", 3_000, build));
}
