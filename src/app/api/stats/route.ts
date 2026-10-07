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
  const launchesPerDayRaw = db
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

  // Merge historical daily counts (Bitquery archive import) for dates that
  // have no real per-launch rows — real data always wins on overlap.
  const realDates = new Set(launchesPerDayRaw.map((r) => r.date));
  const historyRows = db
    .prepare(
      `SELECT date, launchpad, count FROM launch_history WHERE count > 0 ORDER BY date ASC`
    )
    .all() as { date: string; launchpad: string; count: number }[];
  const historyTotal = { all: 0, last7: 0, last30: 0 };
  for (const h of historyRows) {
    if (realDates.has(h.date)) continue;
    historyTotal.all += h.count;
    const row: DailyLaunch = { date: h.date, launchpad: h.launchpad, count: h.count };
    launchesPerDayRaw.push(row);
    if (h.date >= new Date(now - 7 * 86400 * 1000).toISOString().slice(0, 10)) {
      historyTotal.last7 += h.count;
    }
    if (h.date >= new Date(now - 30 * 86400 * 1000).toISOString().slice(0, 10)) {
      historyTotal.last30 += h.count;
    }
  }

  // Zero-fill: ensure every day in the range exists so the chart
  // renders one slot per day even when data only covers a few days
  const countsByDatePad = new Map<string, Map<string, number>>();
  for (const row of launchesPerDayRaw) {
    if (!countsByDatePad.has(row.date)) countsByDatePad.set(row.date, new Map());
    const pads = countsByDatePad.get(row.date)!;
    pads.set(row.launchpad, (pads.get(row.launchpad) ?? 0) + row.count);
  }
  const launchesPerDay: DailyLaunch[] = [];
  for (let i = 89; i >= 0; i--) {
    const date = new Date((now - i * 86400) * 1000).toISOString().slice(0, 10);
    const pads = countsByDatePad.get(date);
    if (pads) {
      for (const [launchpad, count] of pads) {
        launchesPerDay.push({ date, launchpad, count });
      }
    } else {
      launchesPerDay.push({ date, launchpad: "pumpfun", count: 0 });
    }
  }

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
      totalLaunches: totalLaunches.count + historyTotal.all,
      uniqueDevs: uniqueDevs.count,
      last24h: last24h.count,
      last7d: last7d.count + historyTotal.last7,
      last30d: last30d.count + historyTotal.last30,
    },
    launchesPerDay,
    topDevs,
    verdictStats,
  });
}
