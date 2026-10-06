import Database from "better-sqlite3";
import path from "path";
import type { WalletReport } from "./types";

/**
 * SQLite persistence: wallet report cache, watchlist, and feed events.
 * Stored in project root as bigbrother.db.
 */

const DB_PATH = path.join(process.cwd(), "bigbrother.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
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

export function add_launch(l: {
  signature: string;
  mint: string;
  launchpad: string;
  name: string | null;
  symbol: string | null;
  dev: string;
  blockTime: number;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO launches (signature, mint, launchpad, name, symbol, dev, block_time, dev_score, dev_verdict)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    )
    .run(l.signature, l.mint, l.launchpad, l.name, l.symbol, l.dev, l.blockTime);
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
