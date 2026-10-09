import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ensureCoinsTable, ensureMarketScan } from "@/lib/market";
import { ensureMonitorStarted } from "@/lib/monitor";
import { ensureCalloutPicks } from "@/lib/callouts";

export const dynamic = "force-dynamic";

const LIMIT = 40;

// One row per coin (the monitor can record a mint more than once).
const SELECT = `
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
    SELECT mint, MIN(block_time) AS bt, MAX(name) AS name, MAX(symbol) AS symbol,
           MAX(launchpad) AS launchpad, MAX(dev) AS dev,
           MAX(dev_verdict) AS v, MAX(dev_score) AS s
    FROM launches WHERE block_time >= ? GROUP BY mint
  ) l
  LEFT JOIN coins c ON c.mint = l.mint`;

export async function GET() {
  ensureMonitorStarted();
  ensureCoinsTable();
  ensureMarketScan();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const day = now - 86400;

  const newLaunches = db
    .prepare(`${SELECT} ORDER BY l.bt DESC LIMIT ?`)
    .all(now - 3 * 3600, LIMIT);
  // live (not migrated) coins from Crazy / Proven / Good devs, biggest first
  const topDevCoins = db
    .prepare(
      `${SELECT} WHERE l.v = 'Legit' AND COALESCE(c.migrated, 0) = 0
       ORDER BY COALESCE(c.mcap, 0) DESC, l.bt DESC LIMIT ?`
    )
    .all(day, LIMIT);
  const migrated = db
    .prepare(`${SELECT} WHERE c.migrated = 1 ORDER BY c.migrated_at DESC, l.bt DESC LIMIT ?`)
    .all(0, LIMIT);
  // callout picks, newest launch first (slot numbers depend on the slot length,
  // so order by the coin's own launch time)
  ensureCalloutPicks(now);
  const callouts = db
    .prepare(`${SELECT} JOIN callouts k ON k.mint = l.mint ORDER BY l.bt DESC LIMIT ?`)
    .all(day, LIMIT);

  const one = (sql: string, ...a: number[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  return NextResponse.json({
    stats: {
      launches24h: one("SELECT COUNT(DISTINCT mint) AS n FROM launches WHERE block_time >= ?", day),
      totalLaunches: one("SELECT COUNT(DISTINCT mint) AS n FROM launches"),
      devs: one("SELECT COUNT(DISTINCT dev) AS n FROM launches"),
      migrated: one("SELECT COUNT(*) AS n FROM coins WHERE migrated = 1"),
      callouts: one("SELECT COUNT(*) AS n FROM callouts"),
    },
    newLaunches,
    topDevCoins,
    migrated,
    callouts,
  });
}
