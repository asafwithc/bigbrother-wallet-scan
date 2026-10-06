import { PublicKey, type Logs } from "@solana/web3.js";
import { LAUNCHPADS, type LaunchpadConfig } from "./launchpads";
import {
  parseCreateArgs,
  parseCreateEventData,
  findMintInTx,
} from "./sources/pumpfun";
import { rpc, connection } from "./solana";
import { add_launch, add_event, get_watchlist, update_launch_dev } from "./db";
import { analyzeWallet } from "./analysis/analyze";

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

const state = new Map<string, { status: MonitorStatus; lastEventAt: number | null; launches: number }>();

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

async function watchLaunchpad(lp: LaunchpadConfig): Promise<void> {
  const program = new PublicKey(lp.programId!);
  let backoff = 2_000;

  const subscribe = async (): Promise<void> => {
    try {
      setState(lp.id, "connecting");
      connection.onLogs(
        program,
        ({ logs, err, signature }: Logs & { signature: string }) => {
          notifCount++;
          if (notifCount % 1000 === 0) {
            console.log(`[monitor] ${lp.id}: ${notifCount} notifications so far`);
          }
          touch(lp.id);
          if (err) return;

          // fast path: pump.fun emits CreateEvent as "Program data:" base64
          // directly in the logs — full launch info with zero RPC calls
          if (lp.id === "pumpfun") {
            for (const line of logs) {
              if (line.startsWith("Program data: ")) {
                const ev = parseCreateEventData(line.slice("Program data: ".length));
                if (ev) {
                  recordLaunch(lp, {
                    signature,
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

          // fallback path: fetch + parse the transaction
          if (logs.some((l: string) => lp.createLogPattern.test(l))) {
            console.log(`[monitor] ${lp.id}: create log matched ${signature.slice(0, 16)}…`);
            enqueue(lp, signature);
          }
        },
        "confirmed"
      );
      console.log(`[monitor] ${lp.id}: websocket subscribed`);
      setState(lp.id, "live");
      backoff = 2_000;
    } catch (err) {
      console.warn(
        `[monitor] ${lp.id}: ws subscribe failed, retrying in ${backoff}ms — ${String(err).slice(0, 120)}`
      );
      setState(lp.id, "offline");
      setTimeout(() => void subscribe(), backoff);
      backoff = Math.min(backoff * 2, 60_000);
    }
  };

  await subscribe();

  // health check: a busy program with zero notifications for 10 minutes
  // means the socket silently died — force a reconnect
  setInterval(() => {
    const s = state.get(lp.id);
    if (!s || s.status !== "live") return;
    const stale = s.lastEventAt === null || Date.now() - s.lastEventAt > 10 * 60_000;
    if (stale) {
      console.warn(`[monitor] ${lp.id}: socket stale, resubscribing`);
      setState(lp.id, "connecting");
      void subscribe();
    }
  }, 5 * 60_000);
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
  queueDevAnalysis(l.dev, label);
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
const devQueue: { dev: string; via: string; attempts: number }[] = [];
let analyzing = false;

function queueDevAnalysis(dev: string, via: string): void {
  if (devQueue.some((q) => q.dev === dev)) return;
  if (devQueue.length >= 30) return; // don't let the queue grow unbounded
  devQueue.push({ dev, via, attempts: 0 });
  void drainAnalysis();
}

async function drainAnalysis(): Promise<void> {
  if (analyzing) return;
  analyzing = true;
  while (devQueue.length > 0) {
    const item = devQueue.shift()!;
    const { dev, via } = item;
    try {
      console.log(`[monitor] analyzing dev ${short(dev)} (launch: ${via})…`);
      const report = await analyzeWallet(dev, false); // cache-aware
      update_launch_dev(dev, report.score, report.verdict);
      console.log(
        `[monitor] dev ${short(dev)} => ${report.verdict} (${report.score}/100), ${report.tokens.length} token(s)`
      );
      if (report.verdict === "Likely Rugged") {
        add_event(
          dev,
          "flag",
          `🚨 LIVE FLAG: dev ${short(dev)} (launch ${via}) scored ${report.score}/100 — ${report.verdict}`,
          report.score,
          report.verdict
        );
      }
    } catch (err) {
      // RPC throttling/outages are common on the public endpoint — put the
      // dev back in the queue (with backoff) instead of dropping the verdict.
      console.warn(
        `[monitor] dev analysis ${short(dev)} failed: ${String(err).slice(0, 120)}`
      );
      if (item.attempts < 3) {
        item.attempts++;
        const delay = 60_000 * item.attempts;
        console.log(
          `[monitor] re-queuing dev ${short(dev)} in ${delay / 1000}s (attempt ${item.attempts + 1}/4)`
        );
        setTimeout(() => {
          if (!devQueue.some((q) => q.dev === dev)) {
            devQueue.push(item);
            void drainAnalysis();
          }
        }, delay);
      }
    }
  }
  analyzing = false;
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
