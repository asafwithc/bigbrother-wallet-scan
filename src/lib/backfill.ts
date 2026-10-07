/**
 * Launch catch-up backfill.
 *
 * The realtime monitor only sees launches while it is running, and the
 * on-chain polling fallback only looks 25 signatures back. This module
 * closes the gap using pump.fun's frontend API (see sources/pumpfunApi.ts):
 * every cycle it walks the newest ~1,000 launches and inserts the ones the
 * monitor missed (server downtime, dropped websocket events, RPC outages).
 *
 * History therefore accumulates across restarts and downtime, and the
 * "launches per day" chart fills up as days pass. Multi-day retro-backfill
 * is not possible from the free API (its pagination only reaches ~1,000
 * launches deep).
 */

import { add_launch } from "./db";
import { fetchRecentLaunches } from "./sources/pumpfunApi";

const BACKFILL_PAGES = 15; // 15 × 70 = ~1,050 launches ≈ API's reachable depth
const CYCLE_INTERVAL_MS = 10 * 60_000; // every 10 minutes
const STARTUP_DELAY_MS = 8_000; // let the monitor boot first

let running = false;

export async function runBackfill(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const launches = await fetchRecentLaunches(BACKFILL_PAGES);
    let inserted = 0;
    for (const l of launches) {
      // Synthetic PK: the API doesn't expose the create signature, the
      // mint is unique per launch. INSERT OR IGNORE keeps this idempotent.
      const result = add_launch({
        signature: `api:${l.mint}`,
        mint: l.mint,
        launchpad: "pumpfun",
        name: l.name,
        symbol: l.symbol,
        dev: l.dev,
        blockTime: l.blockTime,
      });
      if (result > 0) inserted += result;
    }
    if (inserted > 0 || launches.length > 0) {
      console.log(
        `[backfill] pump.fun: ${launches.length} launches fetched, ${inserted} new`
      );
    }
    return inserted;
  } catch (err) {
    console.warn(`[backfill] failed: ${String(err).slice(0, 120)}`);
    return 0;
  } finally {
    running = false;
  }
}

/** Idempotent — called once from instrumentation at server boot. */
export function startBackfill(): void {
  const g = globalThis as unknown as { __bbBackfillStarted?: boolean };
  if (g.__bbBackfillStarted) return;
  g.__bbBackfillStarted = true;
  setTimeout(() => {
    void runBackfill();
    setInterval(() => void runBackfill(), CYCLE_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}
