import { PublicKey, type Logs } from "@solana/web3.js";
import WebSocket from "ws";
import { LAUNCHPADS, type LaunchpadConfig } from "./launchpads";
import {
  parseCreateArgs,
  parseCreateEventData,
  findMintInTx,
} from "./sources/pumpfun";
import { rpc, PUBLIC_RPC, RPC_WS_URL } from "./solana";
import { add_launch, add_event, get_watchlist, update_launch_dev, getDb } from "./db";
import { liteAnalyzeDev, provisionalGrade, regradeStaleDevs } from "./analysis/lite";

/**
 * LaunchMonitor — continuously watches configured launchpads for new token
 * creations and records them into the live feed.
 *
 * Two always-on mechanisms, so "constantly checking" never stops:
 *  1. realtime: websocket log subscription per program; transactions whose
 *     logs match the launchpad's create pattern are queued for fetch+parse
 *  2. fallback poller: every 45s lists recent program signatures and
 *     inspects unseen ones (catches dropped/missed websocket events)
 *
 * A transaction counts as a launch when the launchpad program is involved
 * and a mint is initialized in it; the dev = fee payer.
 */

export type MonitorStatus = "live" | "connecting" | "offline" | "unconfigured";

export interface MonitorInfo {
  id: string;
  name: string;
  status: MonitorStatus;
  lastEventAt: number | null;
  launches: number;
}

// Monitor state lives on globalThis: instrumentation.ts and the API routes
// get separate module instances (separate bundles), so a module-level Map
// would make the feed read empty state while the real monitor is live.
interface MonitorState {
  status: MonitorStatus;
  lastEventAt: number | null;
  launches: number;
}
const g = globalThis as unknown as { __bbMonitorState?: Map<string, MonitorState> };
const state: Map<string, MonitorState> = (g.__bbMonitorState ??= new Map());

let started = false;

/** Idempotent across dev-HMR module reloads via globalThis. */
export function ensureMonitorStarted(): void {
  startMonitor();
}

export function startMonitor(): void {
  const g = globalThis as unknown as { __bbMonitorStarted?: boolean };
  if (started || g.__bbMonitorStarted) return;
  started = true;
  g.__bbMonitorStarted = true;
  console.log("[monitor] starting launchpad watchers");
  console.log(`[monitor] instantly graded ${regradeStaleDevs()} repeat-launch dev(s)`);
  setTimeout(() => queueUnscoredDevs(), 5_000);
  setInterval(() => queueUnscoredDevs(), 60_000); // keep working through the backlog
  for (const lp of LAUNCHPADS) {
    state.set(lp.id, { status: "unconfigured", lastEventAt: null, launches: 0 });
    if (!lp.programId) {
      console.log(`[monitor] ${lp.id}: no program id configured, skipping ws`);
      continue;
    }
    void watchLaunchpad(lp);
  }
  setInterval(() => {
    for (const lp of LAUNCHPADS) {
      void pollLaunchpad(lp).catch((err) =>
        console.warn(`[monitor] poll ${lp.id}: ${String(err).slice(0, 120)}`)
      );
    }
  }, 45_000);
}

export function getMonitorStatuses(): MonitorInfo[] {
  return LAUNCHPADS.map((lp) => {
    const s = state.get(lp.id);
    return {
      id: lp.id,
      name: lp.name,
      status: s?.status ?? "offline",
      lastEventAt: s?.lastEventAt ?? null,
      launches: s?.launches ?? 0,
    };
  });
}

/* ----------------------------- websocket path ---------------------------- */

/**
 * Raw WebSocket log subscription.
 *
 * We deliberately do NOT use connection.onLogs: web3.js's WS client stops
 * delivering notifications after transient frame errors ("invalid status
 * code 1006") and its reconnection does not revive existing subscriptions.
 * A raw socket with our own reconnect/staleness logic is rock solid.
 */
interface LogsNotificationValue {
  err: unknown;
  logs: string[];
  signature: string;
}

function wsUrlForProgram(programId: string): { url: string; sub: unknown } {
  return {
    url: RPC_WS_URL,
    sub: {
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [{ mentions: [programId] }, { commitment: "confirmed" }],
    },
  };
}

function handleLogsNotification(lp: LaunchpadConfig, value: {
  err: unknown;
  logs: string[];
  signature: string;
}): void {
  notifCount++;
  if (notifCount % 1000 === 0) {
    console.log(`[monitor] ${lp.id}: ${notifCount} notifications so far`);
  }
  touch(lp.id);
  if (value.err) return;

  // fast path: pump.fun emits CreateEvent as "Program data:" base64
  // directly in the logs — full launch info with zero RPC calls
  if (lp.id === "pumpfun") {
    for (const line of value.logs) {
      if (line.startsWith("Program data: ")) {
        const ev = parseCreateEventData(line.slice("Program data: ".length));
        if (ev) {
          recordLaunch(lp, {
            signature: value.signature,
            mint: ev.mint,
            name: ev.name || null,
            symbol: ev.symbol || null,
            dev: ev.user,
            blockTime: null, // set by recordLaunch
          });
          return;
        }
      }
    }
  }

  // fallback path: fetch + parse the transaction. For pumpfun the
  // CreateEvent fast path catches everything — falling back here
  // hammers the public RPC (retries per fetch) and gets the whole
  // app throttled, starving the dev analysis queue. Only launchpads
  // WITHOUT a fast path may use RPC fetching.
  if (lp.id !== "pumpfun" && value.logs.some((l) => lp.createLogPattern.test(l))) {
    console.log(`[monitor] ${lp.id}: create log matched ${value.signature.slice(0, 16)}…`);
    enqueue(lp, value.signature);
  }
}

async function watchLaunchpad(lp: LaunchpadConfig): Promise<void> {
  const program = new PublicKey(lp.programId!);
  const { url, sub } = wsUrlForProgram(lp.programId!);
  let backoff = 2_000;
  let closed = false;

  const connect = (): void => {
    if (closed) return;
    try {
      setState(lp.id, "connecting");
      const ws = new WebSocket(url, { handshakeTimeout: 15_000 });

      ws.on("open", () => {
        ws.send(JSON.stringify(sub));
        console.log(`[monitor] ${lp.id}: websocket subscribed (raw ws)`);
        setState(lp.id, "live");
        backoff = 2_000;
      });

      ws.on("message", (data: unknown) => {
        try {
          const msg = JSON.parse(String(data)) as {
            method?: string;
            params?: { result: { value: Logs & { signature: string } } };
          };
          if (msg.method === "logsNotification" && msg.params) {
            handleLogsNotification(lp, msg.params.result.value);
          }
        } catch {
          // ignore malformed frames
        }
      });

      ws.on("error", (err: Error) => {
        console.warn(
          `[monitor] ${lp.id}: ws error — ${String(err).slice(0, 120)}`
        );
      });

      ws.on("close", () => {
        if (closed) return;
        setState(lp.id, "offline");
        console.warn(
          `[monitor] ${lp.id}: ws closed, reconnecting in ${backoff}ms`
        );
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 60_000);
      });

      // hard liveness: if no data for 90s (pump.fun is busy), force reconnect
      const watchdog = setInterval(() => {
        const s = state.get(lp.id);
        if (!s) return;
        const stale =
          s.lastEventAt === null || Date.now() - s.lastEventAt > 90_000;
        if (stale) {
          console.warn(`[monitor] ${lp.id}: ws stale, forcing reconnect`);
          try {
            ws.terminate();
          } catch {
            /* already dead */
          }
          clearInterval(watchdog);
        }
      }, 30_000);
      ws.on("close", () => clearInterval(watchdog));
    } catch (err) {
      console.warn(
        `[monitor] ${lp.id}: ws connect failed, retrying in ${backoff}ms — ${String(err).slice(0, 120)}`
      );
      setState(lp.id, "offline");
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  };

  connect();
  void program;
}

/* --------------------------- processing pipeline -------------------------- */

const queue: { lp: LaunchpadConfig; signature: string }[] = [];
let draining = false;
let notifCount = 0;
const seen = new Set<string>();

function enqueue(lp: LaunchpadConfig, signature: string): void {
  if (seen.has(signature)) return;
  if (seen.size > 20_000) seen.clear();
  queue.push({ lp, signature });
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const { lp, signature } = queue.shift()!;
    try {
      await inspectTransaction(lp, signature);
    } catch (err) {
      console.warn(`[monitor] inspect ${signature.slice(0, 12)}: ${String(err).slice(0, 120)}`);
    }
  }
  draining = false;
}

/** Fetch a signature and record it if it is a token creation. */
async function inspectTransaction(lp: LaunchpadConfig, signature: string): Promise<void> {
  if (seen.has(signature)) return;
  if (seen.size > 20_000) seen.clear();
  seen.add(signature);

  let tx;
  try {
    tx = await rpc.getParsedTransaction(signature);
  } catch (err) {
    seen.delete(signature); // transient failure — allow retry on next poll
    console.warn(`[monitor] ${lp.id}: inspect ${signature.slice(0, 12)}…: ${String(err).slice(0, 100)}`);
    return;
  }
  if (!tx || (tx.meta?.err ?? null)) return;

  const mint = findMintInTx(tx);
  if (!mint) {
    console.warn(`[monitor] ${lp.id}: create tx ${signature.slice(0, 12)}… but no mint found in tx`);
    return; // ordinary trade, not a launch
  }

  const dev = tx.transaction.message.accountKeys[0]?.pubkey.toBase58() ?? null;
  if (!dev) return;

  // pump.fun-style creates carry name/symbol in the instruction args
  let name: string | null = null;
  let symbol: string | null = null;
  const allIxs = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];
  for (const ix of allIxs) {
    const data = (ix as { data?: unknown }).data;
    if (typeof data === "string") {
      const args = parseCreateArgs(data);
      if (args) {
        name = args.name || null;
        symbol = args.symbol || null;
        break;
      }
    }
  }

  recordLaunch(lp, {
    signature,
    mint,
    name,
    symbol,
    dev,
    blockTime: tx.blockTime ?? null,
  });
}

/** Persist a detected launch + emit feed events. Deduped by signature. */
function recordLaunch(
  lp: LaunchpadConfig,
  l: {
    signature: string;
    mint: string;
    name: string | null;
    symbol: string | null;
    dev: string;
    blockTime: number | null;
  }
): void {
  if (seenLaunchSignatures.has(l.signature)) return;
  seenLaunchSignatures.add(l.signature);

  add_launch({
    signature: l.signature,
    mint: l.mint,
    launchpad: lp.id,
    name: l.name,
    symbol: l.symbol,
    dev: l.dev,
    blockTime: l.blockTime ?? Math.floor(Date.now() / 1000),
  });

  const s = state.get(lp.id);
  if (s) s.launches++;
  touch(lp.id);

  const label = l.symbol
    ? `${l.symbol} (${l.mint.slice(0, 6)}…)`
    : `${l.mint.slice(0, 6)}…`;
  add_event(
    l.dev,
    "launch",
    `🚀 new ${lp.name} launch: ${label} by dev ${short(l.dev)}`,
    null,
    null
  );
  if (get_watchlist().some((w) => w.address === l.dev)) {
    add_event(l.dev, "flag", `🚨 watched dev ${short(l.dev)} just launched ${label}`);
  }

  // >>> real-time: score this dev's rug risk immediately
  // instant grade from our own records, so a repeat launcher never shows as unknown
  // (only when the dev has no real grade yet; the full check below refines it)
  const cur = getDb()
    .prepare("SELECT MAX(dev_verdict) AS v FROM launches WHERE dev = ?")
    .get(l.dev) as { v: string | null };
  const quick = cur.v === null || cur.v === "Unknown" ? provisionalGrade(l.dev) : null;
  if (quick) update_launch_dev(l.dev, quick.score, quick.verdict);
  queueDevAnalysis(l.dev, label, l.mint);
  console.log(`[monitor] ${lp.id}: LAUNCH ${label} by ${short(l.dev)} — https://pump.fun/coin/${l.mint}`);
}

const seenLaunchSignatures = new Set<string>();

/* --------------------- real-time dev risk analysis ----------------------- */

/**
 * The moment a launch is detected, the dev wallet is queued for a full
 * risk analysis. Results are written back onto the launch rows and the
 * feed, so the UI shows the verdict seconds after the token appears.
 * One analysis at a time — the public RPC can't take more.
 */
const devQueue: { dev: string; via: string; mint: string | null; attempts: number }[] = [];
let activeAnalyses = 0;
const MAX_PARALLEL = 6; // lite checks are cheap (DexScreener + ≤1 RPC call)

function queueDevAnalysis(dev: string, via: string, mint: string | null = null): void {
  if (devQueue.some((q) => q.dev === dev)) return;
  if (devQueue.length >= 300) return; // don't let the queue grow unbounded
  devQueue.push({ dev, via, mint, attempts: 0 });
  void drainAnalysis();
}

/** Re-run the full check on every dev with 2+ coins (after a grading change). */
export function requeueRepeatDevs(): number {
  const rows = getDb()
    .prepare(
      "SELECT dev, MAX(mint) AS mint FROM launches GROUP BY dev HAVING COUNT(DISTINCT mint) >= 2 ORDER BY COUNT(DISTINCT mint) DESC"
    )
    .all() as { dev: string; mint: string }[];
  for (const r of rows) {
    if (!devQueue.some((q) => q.dev === r.dev))
      devQueue.push({ dev: r.dev, via: "regrade", mint: r.mint, attempts: 0 });
  }
  void drainAnalysis();
  return rows.length;
}

/** Score devs that were recorded while the analyzer was broken/offline. */
export function queueUnscoredDevs(limit = 150): void {
  const rows = getDb()
    .prepare(
      "SELECT dev, mint FROM launches WHERE dev_verdict IS NULL GROUP BY dev ORDER BY COUNT(*) DESC, MAX(block_time) DESC LIMIT ?"
    )
    .all(limit) as { dev: string; mint: string }[];
  for (const r of rows) queueDevAnalysis(r.dev, "backlog", r.mint);

  // Unknown is only for single-launch devs: anyone marked Unknown with 2+ coins gets re-graded.
  const stale = getDb()
    .prepare(
      "SELECT dev, MAX(mint) AS mint FROM launches GROUP BY dev HAVING MAX(dev_verdict) = 'Unknown' AND COUNT(DISTINCT mint) >= 2 LIMIT 300"
    )
    .all() as { dev: string; mint: string }[];
  for (const r of stale) {
    if (rechecked.has(r.dev)) continue;
    rechecked.add(r.dev);
    queueDevAnalysis(r.dev, "recheck", r.mint);
  }
}
const rechecked = new Set<string>();

async function drainAnalysis(): Promise<void> {
  while (devQueue.length > 0 && activeAnalyses < MAX_PARALLEL) {
    const item = devQueue.shift()!;
    activeAnalyses++;
    void analyzeOne(item).finally(() => {
      activeAnalyses--;
      void drainAnalysis();
    });
  }
}

async function analyzeOne(item: (typeof devQueue)[number]): Promise<void> {
  const { dev, via, mint } = item;
  try {
    const r = await Promise.race([
      liteAnalyzeDev(dev, mint),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout (45s)")), 45_000)),
    ]);
    update_launch_dev(dev, r.score, r.verdict);
    console.log(`[monitor] dev ${short(dev)} => ${r.verdict} (${r.score}/100): ${r.reason}`);
    if (r.verdict === "Likely Rugged") {
      add_event(
        dev,
        "flag",
        `🚨 LIVE FLAG: dev ${short(dev)} (launch ${via}) scored ${r.score}/100 — ${r.reason}`,
        r.score,
        r.verdict
      );
    }
  } catch (err) {
    console.warn(`[monitor] dev check ${short(dev)} failed: ${String(err).slice(0, 120)}`);
    if (item.attempts < 3) {
      item.attempts++;
      setTimeout(() => {
        if (!devQueue.some((q) => q.dev === dev)) {
          devQueue.push(item);
          void drainAnalysis();
        }
      }, 15_000 * item.attempts);
    }
  }
}

/* --------------------------- polling fallback ----------------------------- */

async function pollLaunchpad(lp: LaunchpadConfig): Promise<void> {
  if (!lp.programId) return;

  // The websocket path works with zero RPC calls. While it is healthy and
  // delivering events, don't burn RPC budget on polling — it competes with
  // the dev analysis queue and gets everything throttled. Polling only
  // resumes when the socket looks dead (no events for 90s).
  const s = state.get(lp.id);
  if (s?.status === "live" && s.lastEventAt && Date.now() - s.lastEventAt < 90_000) {
    return;
  }

  const program = new PublicKey(lp.programId);

  const sigs = await rpc.getSignaturesForAddress(program, { limit: 25 });
  if (sigs.length > 0) touch(lp.id);
  const unseen = sigs.filter((x) => !x.err && !seen.has(x.signature));

  // websocket down? deep-fetch more aggressively to backfill anything missed
  const budget = 15;

  for (const sig of unseen.slice(0, budget)) {
    await inspectTransaction(lp, sig.signature);
  }
  void program;
}

function setState(id: string, status: MonitorStatus): void {
  const s = state.get(id);
  if (s) s.status = status;
}
function touch(id: string): void {
  const s = state.get(id);
  if (s) s.lastEventAt = Date.now();
}
function short(a: string): string {
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}
