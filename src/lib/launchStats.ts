import { getDb } from "./db";

/**
 * Real launch counts for the "Launches per day" chart. Sources, best first:
 *
 *  - Dune (needs DUNE_API_KEY), exact per-day numbers from public queries:
 *      pump.fun  - launches and graduations per day, refreshed daily;
 *      StonkFun  - launches per day from a community-uploaded dataset that
 *                  can lag by weeks and has no graduation counts.
 *  - Jupiter's public launchpad stats (no key): mints and graduates for the
 *    last 24 hours, 7 days and 30 days, not day by day. Today's bar is the
 *    real last-24h count, and every check saves it against today's date.
 *
 * Per launchpad, a past day uses its Dune row, else a saved Jupiter count.
 * A day with neither is an estimate, marked as such in the tooltip: what is
 * left of its Jupiter period total (days 2-7, days 8-30) is split across the
 * period's unknown days in proportion to each day's real new-token trading
 * volume, which Jupiter does publish per day. Without volume data the split
 * is even (a plain daily average).
 *
 * Our own monitor's counts are not used: on the public RPC it records only a
 * fraction of what actually launches.
 */

const JUP_URL = "https://datapi.jup.ag/v3/launchpads/stats";
const JUP_PUMP = "pump.fun";
const JUP_STONK = "stonkfun";
const CACHE_MS = 10 * 60_000;

type PadId = "pumpfun" | "stonk";
const PADS: PadId[] = ["pumpfun", "stonk"];
const PAD_NAME: Record<PadId, string> = { pumpfun: "pump.fun", stonk: "StonkFun" };
// Whether a launchpad's exact Dune days can be taken out of Jupiter's period
// totals. StonkFun's two sources count the same thing (their totals agree to a
// few percent). pump.fun's do not: Dune counts about 15% more than Jupiter.
const SUBTRACT_EXACT: Record<PadId, boolean> = { pumpfun: false, stonk: true };

interface DuneSource {
  pad: PadId;
  queryId: number;
  dayCol: string;
  mintsCol: string;
  gradCol: string | null;
  filter: string | null;
}
const DUNE_SOURCES: DuneSource[] = [
  // "Daily Tokens Created": one row per day for pump.fun
  { pad: "pumpfun", queryId: 4861426, dayCol: "date_time", mintsCol: "daily_token_count", gradCol: "daily_graduated_token_count", filter: null },
  // "daily tokens deployed": one row per (day, launchpad)
  { pad: "stonk", queryId: 4010816, dayCol: "day", mintsCol: "tokens_launched", gradCol: null, filter: "launchpad = 'stonkfun'" },
];
const DUNE_REFRESH_S = 12 * 3600;
const DUNE_RETRY_MS = 30 * 60_000;

const DAY_MS = 86_400_000;
const MAX_DAYS = 90;
const AVG_DAYS = 30; // how far back Jupiter's windows reach

export type Source = "live" | "exact" | "saved" | "estimate" | "average" | "none";
export interface ChartDay {
  date: string; // YYYY-MM-DD (UTC)
  pump: number;
  stonk: number;
  /** null = not known for this day */
  pumpMigrated: number | null;
  stonkMigrated: number | null;
  pumpSource: Source;
  stonkSource: Source;
  /** tooltip lines for anything that isn't a plain full-day count */
  notes: string[];
}
export interface LaunchChart {
  days: ChartDay[];
  /** launches per day, averaged over the last 7 full days */
  week: { pump: number; stonk: number } | null;
  source: "jupiter" | null;
}

interface Win {
  mints: number;
  graduates: number;
}
interface Pad {
  d1: Win;
  d7: Win;
  d30: Win;
}
export interface JupStats {
  pump: Pad;
  stonk: Pad;
  /** new-token trading volume (USD) per day, date -> volume, last 30 days */
  pumpVol?: Record<string, number>;
  stonkVol?: Record<string, number>;
  at: number;
}
/** a saved Jupiter 24h count for one launchpad on one day */
export interface Saved {
  mints: number;
  graduates: number;
  updated_at: number;
}
/** exact numbers for one launchpad on one day, from Dune */
export interface Exact {
  mints: number;
  graduates: number | null;
}

let cache: JupStats | null = null;
let tableReady = false;
let duneNextTryMs = 0;
let duneBusy = false;

function ensureTables(): void {
  if (tableReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS launchpad_daily (
      date TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
      launchpad TEXT NOT NULL,      -- pumpfun | stonk
      mints INTEGER NOT NULL,       -- Jupiter 24h count as of updated_at
      graduates INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,  -- unix seconds
      PRIMARY KEY (date, launchpad)
    );
    CREATE TABLE IF NOT EXISTS launchpad_history (
      date TEXT NOT NULL,           -- YYYY-MM-DD (UTC)
      launchpad TEXT NOT NULL,      -- pumpfun | stonk
      mints INTEGER NOT NULL,       -- exact launches that day (Dune)
      graduates INTEGER,            -- exact graduations that day, if the query has them
      imported_at INTEGER NOT NULL, -- unix seconds
      PRIMARY KEY (date, launchpad)
    );
    CREATE TABLE IF NOT EXISTS dune_imports (
      query_id INTEGER PRIMARY KEY,
      checked_at INTEGER NOT NULL   -- unix seconds of the last successful read
    );
  `);
  const cols = (db.pragma("table_info(launchpad_history)") as { name: string }[]).map((c) => c.name);
  if (!cols.includes("graduates")) db.exec("ALTER TABLE launchpad_history ADD COLUMN graduates INTEGER");
  tableReady = true;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const shortDay = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/* -------------------------------- Jupiter -------------------------------- */

function saveSnapshot(s: JupStats): void {
  ensureTables();
  const up = getDb().prepare(
    `INSERT INTO launchpad_daily (date, launchpad, mints, graduates, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date, launchpad) DO UPDATE SET
       mints = excluded.mints, graduates = excluded.graduates, updated_at = excluded.updated_at`
  );
  const date = isoDay(s.at);
  const at = Math.floor(s.at / 1000);
  up.run(date, "pumpfun", s.pump.d1.mints, s.pump.d1.graduates, at);
  up.run(date, "stonk", s.stonk.d1.mints, s.stonk.d1.graduates, at);
}

async function fetchJupiter(): Promise<JupStats | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  try {
    const res = await fetch(JUP_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      launchpads?: {
        launchpad: string;
        stats1d?: Win;
        stats7d?: Win;
        stats30d?: Win;
        newDailyStats?: { date?: string; volume?: number }[];
      }[];
    };
    const vol = (id: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const r of body.launchpads?.find((x) => x.launchpad === id)?.newDailyStats ?? []) {
        if (r.date && typeof r.volume === "number") out[r.date.slice(0, 10)] = r.volume;
      }
      return out;
    };
    const pad = (id: string): Pad | null => {
      const p = body.launchpads?.find((x) => x.launchpad === id);
      if (!p) return null;
      const w = (s?: Win): Win => ({ mints: s?.mints ?? 0, graduates: s?.graduates ?? 0 });
      return { d1: w(p.stats1d), d7: w(p.stats7d), d30: w(p.stats30d) };
    };
    const pump = pad(JUP_PUMP);
    if (!pump) throw new Error("pump.fun missing from response");
    const zero: Win = { mints: 0, graduates: 0 };
    cache = {
      pump,
      stonk: pad(JUP_STONK) ?? { d1: zero, d7: zero, d30: zero },
      pumpVol: vol(JUP_PUMP),
      stonkVol: vol(JUP_STONK),
      at: Date.now(),
    };
    saveSnapshot(cache);
  } catch (err) {
    // a stale answer is better than none
    console.warn(`[launch-stats] Jupiter fetch failed: ${String(err).slice(0, 120)}`);
  }
  return cache;
}

/** Launchpad-wide totals for the last 24 hours (Jupiter), or null when unavailable. */
export async function getLaunchTotals24h(): Promise<{
  pump: number;
  stonk: number;
  pumpMigrated: number;
  stonkMigrated: number;
} | null> {
  const j = await fetchJupiter();
  if (!j) return null;
  return {
    pump: j.pump.d1.mints,
    stonk: j.stonk.d1.mints,
    pumpMigrated: j.pump.d1.graduates,
    stonkMigrated: j.stonk.d1.graduates,
  };
}

/* ---------------------------------- Dune --------------------------------- */

/**
 * Import exact per-day numbers from Dune into launchpad_history. Reading a
 * query's latest result uses the account's datapoint allowance, so each query
 * is read at most every 12 hours and, after its first import, only for the
 * newest few days.
 */
async function refreshDuneHistory(nowMs: number): Promise<void> {
  const key = process.env.DUNE_API_KEY;
  if (!key || duneBusy || nowMs < duneNextTryMs) return;
  ensureTables();
  const db = getDb();
  const nowS = Math.floor(nowMs / 1000);
  const checkedAt = (id: number) =>
    (db.prepare("SELECT checked_at FROM dune_imports WHERE query_id = ?").get(id) as
      | { checked_at: number }
      | undefined)?.checked_at ?? null;
  const due = DUNE_SOURCES.filter((s) => {
    const at = checkedAt(s.queryId);
    return at === null || nowS - at >= DUNE_REFRESH_S;
  });
  if (due.length === 0) return;

  duneBusy = true;
  try {
    for (const src of due) {
      const last = checkedAt(src.queryId);
      // first time: the whole chart window; later: the days since, plus a few
      // already-stored ones in case a count was revised
      const limit =
        last === null ? MAX_DAYS + 6 : Math.min(MAX_DAYS + 6, Math.ceil((nowS - last) / 86_400) + 4);
      const url = new URL(`https://api.dune.com/api/v1/query/${src.queryId}/results`);
      const cols = [src.dayCol, src.mintsCol, ...(src.gradCol ? [src.gradCol] : [])];
      url.searchParams.set("columns", cols.join(","));
      if (src.filter) url.searchParams.set("filters", src.filter);
      url.searchParams.set("sort_by", `${src.dayCol} desc`);
      url.searchParams.set("limit", String(limit));
      const res = await fetch(url, {
        headers: { "X-Dune-API-Key": key },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`query ${src.queryId}: HTTP ${res.status} ${(await res.text()).slice(0, 100)}`);
      const body = (await res.json()) as {
        execution_ended_at?: string;
        result?: { rows?: Record<string, unknown>[] };
      };
      // a day is only complete if the query last ran after that day ended
      const ranOn = isoDay(Date.parse(body.execution_ended_at ?? "") || nowMs);
      const up = db.prepare(
        `INSERT INTO launchpad_history (date, launchpad, mints, graduates, imported_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(date, launchpad) DO UPDATE SET
           mints = excluded.mints, graduates = excluded.graduates, imported_at = excluded.imported_at`
      );
      let n = 0;
      for (const r of body.result?.rows ?? []) {
        const date = String(r[src.dayCol] ?? "").slice(0, 10);
        const mints = r[src.mintsCol];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= ranOn || typeof mints !== "number") continue;
        const grad = src.gradCol ? r[src.gradCol] : null;
        n += up.run(date, src.pad, mints, typeof grad === "number" ? grad : null, nowS).changes;
      }
      db.prepare(
        "INSERT INTO dune_imports (query_id, checked_at) VALUES (?, ?) ON CONFLICT(query_id) DO UPDATE SET checked_at = excluded.checked_at"
      ).run(src.queryId, nowS);
      console.log(`[launch-stats] Dune: ${PAD_NAME[src.pad]} ${n} day(s) imported (query last ran ${ranOn})`);
    }
  } catch (err) {
    duneNextTryMs = nowMs + DUNE_RETRY_MS;
    console.warn(`[launch-stats] Dune import failed: ${String(err).slice(0, 200)}`);
  } finally {
    duneBusy = false;
  }
}

/* --------------------------------- chart --------------------------------- */

interface Cell {
  source: Source;
  mints: number;
  graduates: number | null;
  note: string | null;
}

/**
 * Pure chart builder (unit tested).
 * `saved` maps date -> launchpad -> Jupiter 24h count; `history` maps date -> launchpad -> Dune numbers.
 */
export function buildChart(
  jup: JupStats | null,
  saved: Map<string, Partial<Record<PadId, Saved>>>,
  history: Map<string, Partial<Record<PadId, Exact>>>,
  nowMs: number
): LaunchChart {
  if (!jup && saved.size === 0 && history.size === 0) return { days: [], week: null, source: null };

  const today = isoDay(nowMs);
  const earliest = [...saved.keys(), ...history.keys()].sort()[0] ?? today;
  const knownSpan = Math.round((Date.parse(today) - Date.parse(earliest)) / DAY_MS) + 1;
  const span = Math.min(MAX_DAYS, Math.max(jup ? AVG_DAYS : 1, knownSpan));
  // index 0 = today, 1 = yesterday, ...
  const dates = Array.from({ length: span }, (_, i) => isoDay(nowMs - i * DAY_MS));

  const column = (pad: PadId): Cell[] => {
    const j = jup ? (pad === "pumpfun" ? jup.pump : jup.stonk) : null;

    const vol = jup ? (pad === "pumpfun" ? jup.pumpVol : jup.stonkVol) ?? {} : {};

    // Fill the unknown days of one Jupiter period. Known days are taken out of
    // the period total first; what is left is split across the unknown days by
    // each day's trading volume, or evenly when volume isn't available.
    const fill = (from: number, to: number, hi: "d7" | "d30", lo: "d1" | "d7") => {
      const out = new Map<number, Cell>();
      if (!j) return out;
      let mints = j[hi].mints - j[lo].mints;
      let grads = j[hi].graduates - j[lo].graduates;
      let nMints = to - from + 1; // days the remaining total still covers
      let nGrads = nMints;
      const gaps: number[] = [];
      for (let i = from; i <= to && i < span; i++) {
        const s = saved.get(dates[i])?.[pad];
        const e = history.get(dates[i])?.[pad];
        if (s) {
          mints -= s.mints;
          grads -= s.graduates;
          nMints--;
          nGrads--;
        } else if (e) {
          if (SUBTRACT_EXACT[pad]) {
            mints -= e.mints;
            nMints--;
            if (e.graduates !== null) {
              grads -= e.graduates;
              nGrads--;
            }
          }
        } else {
          gaps.push(i);
        }
      }
      if (gaps.length === 0 || nMints <= 0 || nGrads <= 0) return out;
      const perDay = Math.max(0, mints / nMints);
      const gradsPerDay = Math.max(0, grads / nGrads);

      const vols = gaps.map((i) => vol[dates[i]] ?? 0);
      const volSum = vols.reduce((a, b) => a + b, 0);
      if (vols.every((v) => v > 0)) {
        gaps.forEach((i, k) => {
          const share = (vols[k] / volSum) * gaps.length;
          out.set(i, {
            source: "estimate",
            mints: Math.round(perDay * share),
            graduates: Math.round(gradsPerDay * share),
            note: "estimated from that day's trading volume",
          });
        });
      } else {
        const first = dates[gaps[gaps.length - 1]];
        const last = dates[gaps[0]];
        const range = first === last ? shortDay(first) : `${shortDay(first)} – ${shortDay(last)}`;
        for (const i of gaps) {
          out.set(i, {
            source: "average",
            mints: Math.round(perDay),
            graduates: Math.round(gradsPerDay),
            note: `daily average, ${range}`,
          });
        }
      }
      return out;
    };
    const filled = new Map([...fill(1, 6, "d7", "d1"), ...fill(7, AVG_DAYS - 1, "d30", "d7")]);

    return dates.map((date, i): Cell => {
      if (i === 0 && j) {
        return { source: "live", mints: j.d1.mints, graduates: j.d1.graduates, note: "last 24 hours" };
      }
      const exact = history.get(date)?.[pad];
      if (exact) return { source: "exact", mints: exact.mints, graduates: exact.graduates, note: null };
      const s = saved.get(date)?.[pad];
      if (s) {
        // a count taken in the last hour of its day is that day's count;
        // an earlier one is the 24 hours up to when the server last checked
        const endOfDay = Date.parse(date) / 1000 + 86_400;
        const hhmm = new Date(s.updated_at * 1000).toISOString().slice(11, 16);
        return {
          source: "saved",
          mints: s.mints,
          graduates: s.graduates,
          note: endOfDay - s.updated_at <= 3600 ? null : `24 hours to ${hhmm} UTC`,
        };
      }
      return filled.get(i) ?? { source: "none", mints: 0, graduates: null, note: null };
    });
  };

  const pump = column("pumpfun");
  const stonk = column("stonk");

  const days: ChartDay[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const p = pump[i];
    const s = stonk[i];
    const notes: string[] = [];
    if (p.source === "none" && s.source === "none") notes.push("no data for this day");
    else if (p.note && p.note === s.note) notes.push(p.note);
    else {
      if (p.note) notes.push(`${PAD_NAME.pumpfun}: ${p.note}`);
      if (s.note) notes.push(`${PAD_NAME.stonk}: ${s.note}`);
    }
    days.push({
      date: dates[i],
      pump: p.mints,
      stonk: s.mints,
      pumpMigrated: p.graduates,
      stonkMigrated: s.graduates,
      pumpSource: p.source,
      stonkSource: s.source,
      notes,
    });
  }

  // "this week": the 7 full days before today, as charted
  const mean = (cells: Cell[]) => Math.round(cells.reduce((t, c) => t + c.mints, 0) / cells.length);
  const week =
    span >= 8
      ? { pump: mean(pump.slice(1, 8)), stonk: mean(stonk.slice(1, 8)) }
      : jup
        ? { pump: Math.round(jup.pump.d7.mints / 7), stonk: Math.round(jup.stonk.d7.mints / 7) }
        : null;

  return { days, week, source: jup ? "jupiter" : null };
}

export async function getLaunchChart(nowMs = Date.now()): Promise<LaunchChart> {
  ensureTables();
  const [jup] = await Promise.all([fetchJupiter(), refreshDuneHistory(nowMs)]);
  const db = getDb();
  const since = isoDay(nowMs - (MAX_DAYS - 1) * DAY_MS);

  const saved = new Map<string, Partial<Record<PadId, Saved>>>();
  for (const r of db
    .prepare("SELECT date, launchpad, mints, graduates, updated_at FROM launchpad_daily WHERE date >= ?")
    .all(since) as (Saved & { date: string; launchpad: PadId })[]) {
    const day = saved.get(r.date) ?? {};
    day[r.launchpad] = r;
    saved.set(r.date, day);
  }

  const history = new Map<string, Partial<Record<PadId, Exact>>>();
  for (const r of db
    .prepare("SELECT date, launchpad, mints, graduates FROM launchpad_history WHERE date >= ?")
    .all(since) as (Exact & { date: string; launchpad: PadId })[]) {
    if (!PADS.includes(r.launchpad)) continue;
    const day = history.get(r.date) ?? {};
    day[r.launchpad] = { mints: r.mints, graduates: r.graduates };
    history.set(r.date, day);
  }

  return buildChart(jup, saved, history, nowMs);
}
