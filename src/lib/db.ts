import Database from "better-sqlite3";
import path from "path";
import type { WalletReport } from "./types";
import { tierSql } from "./tiers";

/**
 * SQLite persistence: wallet report cache, watchlist, and feed events.
 * Stored in project root as bigbrother.db.
 */

// DB_PATH points the app at a database on a persistent disk (e.g. /data/bigbrother.db
// on a hosted volume). Without it, the file sits in the project root.
const DB_PATH = process.env.DB_PATH?.trim() || path.join(process.cwd(), "bigbrother.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      score REAL NOT NULL,
      verdict TEXT NOT NULL,
      report TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      address TEXT PRIMARY KEY,
      label TEXT,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      score REAL,
      verdict TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

    CREATE TABLE IF NOT EXISTS launches (
      signature TEXT PRIMARY KEY,
      mint TEXT NOT NULL,
      launchpad TEXT NOT NULL,
      name TEXT,
      symbol TEXT,
      dev TEXT NOT NULL,
      block_time INTEGER NOT NULL,
      dev_score REAL,
      dev_verdict TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_launches_time ON launches(block_time DESC);
    CREATE INDEX IF NOT EXISTS idx_launches_dev ON launches(dev);

    -- Historical daily launch counts (aggregate only, from Bitquery archive).
    -- Fills the "launches per day" chart for days before the monitor ran.
    CREATE TABLE IF NOT EXISTS launch_history (
      date TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
      launchpad TEXT NOT NULL,
      count INTEGER NOT NULL,
      imported_at INTEGER NOT NULL,
      PRIMARY KEY (date, launchpad)
    );
  `);
  // lightweight migration for dev risk columns
  const cols = (getDb().pragma("table_info(launches)") as { name: string }[]).map(
    (c) => c.name
  );
  if (!cols.includes("dev_score")) {
    getDb().exec("ALTER TABLE launches ADD COLUMN dev_score REAL");
  }
  if (!cols.includes("dev_verdict")) {
    getDb().exec("ALTER TABLE launches ADD COLUMN dev_verdict TEXT");
  }
  return db;
}

export interface LaunchRow {
  signature: string;
  mint: string;
  launchpad: string;
  name: string | null;
  symbol: string | null;
  dev: string;
  blockTime: number;
  devScore: number | null;
  devVerdict: string | null;
}

/** Returns the number of rows actually inserted (0 if the signature was already known). */
export function add_launch(l: {
  signature: string;
  mint: string;
  launchpad: string;
  name: string | null;
  symbol: string | null;
  dev: string;
  blockTime: number;
}): number {
  return getDb()
    .prepare(
      `INSERT OR IGNORE INTO launches (signature, mint, launchpad, name, symbol, dev, block_time, dev_score, dev_verdict)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    )
    .run(l.signature, l.mint, l.launchpad, l.name, l.symbol, l.dev, l.blockTime).changes;
}

/** Attach a dev risk verdict to every recorded launch of that dev. */
export function update_launch_dev(
  dev: string,
  score: number,
  verdict: string
): void {
  getDb()
    .prepare("UPDATE launches SET dev_score = ?, dev_verdict = ? WHERE dev = ?")
    .run(score, verdict, dev);
}

export function get_launches(limit = 30): LaunchRow[] {
  const rows = getDb()
    .prepare(
      "SELECT signature, mint, launchpad, name, symbol, dev, block_time, dev_score, dev_verdict FROM launches ORDER BY block_time DESC LIMIT ?"
    )
    .all(limit) as {
    signature: string;
    mint: string;
    launchpad: string;
    name: string | null;
    symbol: string | null;
    dev: string;
    block_time: number;
    dev_score: number | null;
    dev_verdict: string | null;
  }[];
  return rows.map((r) => ({
    signature: r.signature,
    mint: r.mint,
    launchpad: r.launchpad,
    name: r.name,
    symbol: r.symbol,
    dev: r.dev,
    blockTime: r.block_time,
    devScore: r.dev_score,
    devVerdict: r.dev_verdict,
  }));
}

const TIER_SQL = tierSql("dev_verdict", "dev_score");

/** One filtered page of launches, newest first, plus the total match count. */
export function get_launches_page(opts: {
  limit: number;
  offset: number;
  filter?: string; // "crazy" | "proven" | "good" | "unknown" | "farmer" | "called"
  launchpad?: string;
}): {
  launches: (LaunchRow & { devLaunches: number; called: boolean; mcap: number | null; ath: number | null })[];
  total: number;
} {
  const where: string[] = [];
  const args: (string | number)[] = [];
  // "called" = coins picked for a callout. The caller makes sure the `callouts`
  // and `coins` tables exist (ensureCalloutPicks does both). One row per coin, even if the monitor recorded it twice.
  if (opts.filter === "called")
    where.push(
      `mint IN (SELECT mint FROM callouts)
       AND signature = (SELECT l3.signature FROM launches l3 WHERE l3.mint = launches.mint
                        ORDER BY l3.block_time, l3.signature LIMIT 1)`
    );
  else if (opts.filter && opts.filter in TIER_SQL)
    where.push(`(${TIER_SQL[opts.filter as keyof typeof TIER_SQL]})`);
  if (opts.launchpad) {
    where.push("launchpad = ?");
    args.push(opts.launchpad);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (
    getDb().prepare(`SELECT COUNT(*) AS n FROM launches ${w}`).get(...args) as { n: number }
  ).n;
  const rows = getDb()
    .prepare(
      `SELECT signature, mint, launchpad, name, symbol, dev, block_time, dev_score, dev_verdict,
              (SELECT COUNT(*) FROM launches l2 WHERE l2.dev = launches.dev) AS dev_launches,
              EXISTS (SELECT 1 FROM callouts k WHERE k.mint = launches.mint) AS called,
              (SELECT c.mcap FROM coins c WHERE c.mint = launches.mint) AS mcap,
              (SELECT c.ath FROM coins c WHERE c.mint = launches.mint) AS ath
       FROM launches ${w} ORDER BY block_time DESC LIMIT ? OFFSET ?`
    )
    .all(...args, opts.limit, opts.offset) as {
    signature: string;
    mint: string;
    launchpad: string;
    name: string | null;
    symbol: string | null;
    dev: string;
    block_time: number;
    dev_score: number | null;
    dev_verdict: string | null;
    dev_launches: number;
    called: number;
    mcap: number | null;
    ath: number | null;
  }[];
  return {
    total,
    launches: rows.map((r) => ({
      signature: r.signature,
      mint: r.mint,
      launchpad: r.launchpad,
      name: r.name,
      symbol: r.symbol,
      dev: r.dev,
      blockTime: r.block_time,
      devScore: r.dev_score,
      devVerdict: r.dev_verdict,
      devLaunches: r.dev_launches,
      called: r.called === 1,
      mcap: r.mcap,
      ath: r.ath,
    })),
  };
}

/** Number of launches recorded for a dev wallet. */
export function get_dev_launch_count(dev: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM launches WHERE dev = ?")
    .get(dev) as { n: number };
  return row.n;
}

const CACHE_TTL_SECONDS = 15 * 60; // wallet reports cached for 15 minutes

export function get_cached_report(address: string): WalletReport | null {
  const row = getDb()
    .prepare("SELECT report, updated_at FROM wallets WHERE address = ?")
    .get(address) as { report: string; updated_at: number } | undefined;
  if (!row) return null;
  const age = Math.floor(Date.now() / 1000) - row.updated_at;
  if (age > CACHE_TTL_SECONDS) return null;
  const report = JSON.parse(row.report) as WalletReport;
  report.cached = true;
  return report;
}

export function save_report(report: WalletReport): void {
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `INSERT INTO wallets (address, score, verdict, report, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         score = excluded.score,
         verdict = excluded.verdict,
         report = excluded.report,
         updated_at = excluded.updated_at`
    )
    .run(report.address, report.score, report.verdict, JSON.stringify(report), now);
}

export function add_event(
  address: string,
  kind: string,
  message: string,
  score?: number | null,
  verdict?: string | null
): void {
  getDb()
    .prepare(
      `INSERT INTO events (address, kind, message, score, verdict, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(address, kind, message, score ?? null, verdict ?? null, Math.floor(Date.now() / 1000));
}

export function get_feed(limit = 50): DbEventRow[] {
  return getDb()
    .prepare("SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit) as DbEventRow[];
}

/** Raw event row as stored in SQLite */
export interface DbEventRow {
  id: number;
  address: string;
  kind: string;
  message: string;
  score: number | null;
  verdict: string | null;
  created_at: number;
}

export function add_watch(address: string, label?: string): void {
  getDb()
    .prepare(
      `INSERT INTO watchlist (address, label, added_at) VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET label = COALESCE(excluded.label, label)`
    )
    .run(address, label ?? null, Math.floor(Date.now() / 1000));
  add_event(address, "watch", "Added to watchlist");
}

export function remove_watch(address: string): void {
  getDb().prepare("DELETE FROM watchlist WHERE address = ?").run(address);
}

export function get_watchlist(): { address: string; label: string | null; added_at: number }[] {
  return getDb()
    .prepare("SELECT address, label, added_at FROM watchlist ORDER BY added_at DESC")
    .all() as { address: string; label: string | null; added_at: number }[];
}

/* ------------------------- launch history (aggregate) --------------------- */

export interface HistoryRow {
  date: string;
  launchpad: string;
  count: number;
}

export function upsert_launch_history(
  rows: { date: string; launchpad: string; count: number }[]
): number {
  const stmt = getDb().prepare(
    `INSERT INTO launch_history (date, launchpad, count, imported_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(date, launchpad) DO UPDATE SET
       count = excluded.count,
       imported_at = excluded.imported_at`
  );
  const now = Math.floor(Date.now() / 1000);
  let changes = 0;
  const tx = getDb().transaction((batch: { date: string; launchpad: string; count: number }[]) => {
    for (const r of batch) stmt.run(r.date, r.launchpad, r.count, now);
  });
  tx(rows);
  return changes;
}

export function get_launch_history(): HistoryRow[] {
  return getDb()
    .prepare("SELECT date, launchpad, count FROM launch_history ORDER BY date ASC")
    .all() as HistoryRow[];
}

/** Latest date already present in launch_history (null when empty). */
export function get_history_max_date(): string | null {
  const row = getDb()
    .prepare("SELECT MAX(date) as d FROM launch_history")
    .get() as { d: string | null };
  return row.d;
}
