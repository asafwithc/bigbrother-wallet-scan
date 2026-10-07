/**
 * Historical launch backfill via Bitquery (see sources/bitquery.ts).
 *
 * Imports daily pump.fun launch counts for the last 90 days into the
 * `launch_history` table, which the stats API merges into the
 * "launches per day" chart. Aggregate-only: per-launch/dev detail for
 * past days is not reconstructible, so only the chart + totals use it.
 *
 * Requires BITQUERY_API_KEY in .env (archive access = paid Bitquery
 * feature). Without a key this service stays dormant and the realtime
 * monitor + catch-up backfill run as usual.
 */

import {
  upsert_launch_history,
  get_history_max_date,
} from "./db";
import {
  fetchDailyPumpFunCreates,
  isBitqueryConfigured,
} from "./sources/bitquery";

const WINDOW_DAYS = 90;
const REFRESH_MS = 6 * 60 * 60_000; // re-import every 6h (fixes partial days)
const STARTUP_DELAY_MS = 20_000; // after the catch-up backfill

let running = false;
let lastFullImportAt = 0;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export interface HistoryBackfillResult {
  ok: boolean;
  skipped?: "no-key" | "already-running" | "fresh";
  days?: number;
  total?: number;
  error?: string;
}

export async function runHistoryBackfill(force = false): Promise<HistoryBackfillResult> {
  if (!isBitqueryConfigured()) {
    console.log("[history] BITQUERY_API_KEY not set — skipping historical import");
    return { ok: false, skipped: "no-key" };
  }
  if (running) return { ok: false, skipped: "already-running" };
  running = true;
  try {
    // Incremental: if a recent full import exists, only fix the last 3 days.
    const maxDate = get_history_max_date();
    const sinceDays =
      !force && maxDate && lastFullImportAt > 0 ? 3 : WINDOW_DAYS;

    const till = new Date().toISOString();
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    const counts = await fetchDailyPumpFunCreates(since, till);

    upsert_launch_history(counts.map((c) => ({ date: c.date, launchpad: "pumpfun", count: c.count })));
    lastFullImportAt = Math.floor(Date.now() / 1000);

    const total = counts.reduce((s, c) => s + c.count, 0);
    console.log(
      `[history] bitquery: imported ${counts.length} day(s), ${total.toLocaleString()} launches ` +
        `(since ${since.slice(0, 10)}${maxDate ? `, existing up to ${maxDate}` : ""})`
    );
    return { ok: true, days: counts.length, total };
  } catch (err) {
    const msg = String(err).slice(0, 200);
    console.warn(`[history] import failed: ${msg}`);
    return { ok: false, error: msg };
  } finally {
    running = false;
  }
}

/** Idempotent — called once from instrumentation at server boot. */
export function startHistoryBackfill(): void {
  const g = globalThis as unknown as { __bbHistoryBackfillStarted?: boolean };
  if (g.__bbHistoryBackfillStarted) return;
  g.__bbHistoryBackfillStarted = true;
  if (!isBitqueryConfigured()) {
    console.log(
      "[history] BITQUERY_API_KEY not set — no historical import (add key to .env)"
    );
    return;
  }
  setTimeout(() => {
    void runHistoryBackfill();
    setInterval(() => void runHistoryBackfill(), REFRESH_MS);
  }, STARTUP_DELAY_MS);
}
