import { getDb } from "./db";
import { ensureCoinsTable } from "./market";

/**
 * Callout picks for the Terminal: one randomly chosen launch per 5-minute
 * slot, saved so the list doesn't reshuffle on every refresh. This only
 * builds the list; nothing is bought or posted from here.
 *
 * Picks are filled in lazily when the terminal asks, for the last 30 minutes.
 * A coin is only eligible in the slot where we first saw it, and coins that
 * are already migrated at pick time are skipped (a "launch" that is already
 * on a DEX pool within minutes is almost always a mis-recorded old coin).
 */
export const SLOT_S = 5 * 60;
const LOOKBACK_SLOTS = 6; // 30 minutes

let tableReady = false;
function ensureCalloutsTable(): void {
  if (tableReady) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS callouts (
      slot INTEGER PRIMARY KEY,      -- block_time / SLOT_S
      mint TEXT NOT NULL UNIQUE,
      picked_at INTEGER NOT NULL
    );
  `);
  tableReady = true;
}

/** Fill any missing picks for finished slots. Returns how many were added. */
export function ensureCalloutPicks(nowS = Math.floor(Date.now() / 1000)): number {
  ensureCoinsTable();
  ensureCalloutsTable();
  const db = getDb();
  const current = Math.floor(nowS / SLOT_S);
  const first = current - LOOKBACK_SLOTS;

  const have = new Set(
    (db.prepare("SELECT slot FROM callouts WHERE slot >= ?").all(first) as { slot: number }[]).map(
      (r) => r.slot
    )
  );
  const pick = db.prepare(`
    SELECT l.mint FROM launches l
    LEFT JOIN coins c ON c.mint = l.mint
    WHERE l.block_time >= @from AND l.block_time < @to
      AND COALESCE(c.migrated, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM launches o WHERE o.mint = l.mint AND o.block_time < @from)
      AND NOT EXISTS (SELECT 1 FROM callouts k WHERE k.mint = l.mint)
    GROUP BY l.mint ORDER BY RANDOM() LIMIT 1`);
  const save = db.prepare("INSERT OR IGNORE INTO callouts (slot, mint, picked_at) VALUES (?, ?, ?)");

  let added = 0;
  // finished slots only, so every coin launched in a slot has the same chance
  for (let slot = first; slot < current; slot++) {
    if (have.has(slot)) continue;
    const row = pick.get({ from: slot * SLOT_S, to: (slot + 1) * SLOT_S }) as
      | { mint: string }
      | undefined;
    if (row) added += save.run(slot, row.mint, nowS).changes;
  }
  return added;
}
