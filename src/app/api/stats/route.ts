import { NextResponse } from "next/server";
import Database from "better-sqlite3";
import path from "path";

export const dynamic = "force-dynamic";

const DB_PATH = path.join(process.cwd(), "bigbrother.db");

interface DailyLaunch {
  date: string;
  count: number;
  launchpad: string;
}

interface DevRanking {
  dev: string;
  launches: number;
  devScore: number | null;
  devVerdict: string | null;
}

export async function GET() {
  const db = new Database(DB_PATH);

  // Get total launches
  const totalLaunches = db
    .prepare("SELECT COUNT(*) as count FROM launches")
    .get() as { count: number };

  // Get unique devs ranked
  const uniqueDevs = db
    .prepare("SELECT COUNT(DISTINCT dev) as count FROM launches")
    .get() as { count: number };

  // Get launches in last 24h
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 86400;
  const last24h = db
    .prepare("SELECT COUNT(*) as count FROM launches WHERE block_time >= ?")
    .get(oneDayAgo) as { count: number };

  // Get launches in last 7 days
  const sevenDaysAgo = now - 7 * 86400;
  const last7d = db
    .prepare("SELECT COUNT(*) as count FROM launches WHERE block_time >= ?")
    .get(sevenDaysAgo) as { count: number };

  // Get launches in last 30 days
  const thirtyDaysAgo = now - 30 * 86400;
  const last30d = db
    .prepare("SELECT COUNT(*) as count FROM launches WHERE block_time >= ?")
    .get(thirtyDaysAgo) as { count: number };

  // Get launches per day for last 90 days
  const ninetyDaysAgo = now - 90 * 86400;
  const launchesPerDay = db
    .prepare(
      `SELECT
        date(block_time, 'unixepoch') as date,
        launchpad,
        COUNT(*) as count
      FROM launches
      WHERE block_time >= ?
      GROUP BY date, launchpad
      ORDER BY date ASC`
    )
    .all(ninetyDaysAgo) as DailyLaunch[];

  // Get top devs by launch count
  const topDevs = db
    .prepare(
      `SELECT
        dev,
        COUNT(*) as launches,
        MAX(dev_score) as devScore,
        MAX(dev_verdict) as devVerdict
      FROM launches
      GROUP BY dev
      ORDER BY launches DESC
      LIMIT 100`
    )
    .all() as DevRanking[];

  // Get verdict distribution
  const verdictStats = db
    .prepare(
      `SELECT
        dev_verdict as verdict,
        COUNT(*) as count
      FROM launches
      WHERE dev_verdict IS NOT NULL
      GROUP BY dev_verdict`
    )
    .all() as { verdict: string; count: number }[];

  db.close();

  return NextResponse.json({
    stats: {
      totalLaunches: totalLaunches.count,
      uniqueDevs: uniqueDevs.count,
      last24h: last24h.count,
      last7d: last7d.count,
      last30d: last30d.count,
    },
    launchesPerDay,
    topDevs,
    verdictStats,
  });
}
