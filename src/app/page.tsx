"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FeedEvent, LaunchItem, MonitorInfo } from "@/lib/types";
import { verdictColor } from "@/components/indicators";

interface WatchEntry {
  address: string;
  label: string | null;
  added_at: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [watchlist, setWatchlist] = useState<WatchEntry[]>([]);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [launches, setLaunches] = useState<LaunchItem[]>([]);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const launchesRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [w, f] = await Promise.all([
        fetch("/api/watchlist").then((r) => r.json()),
        fetch("/api/feed").then((r) => r.json()),
      ]);
      setWatchlist(w.watchlist ?? []);
      setEvents(f.events ?? []);
      setLaunches(f.launches ?? []);
      setMonitors(f.monitors ?? []);
    } catch {
      /* dashboard data is best-effort */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 6_000); // live feed refresh
    return () => clearInterval(t);
  }, [load]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const addr = query.trim();
    if (addr.length < 32) {
      setError("That doesn't look like a Solana address (should be ~44 chars).");
      return;
    }
    setError(null);
    router.push(`/wallet/${addr}`);
  }

  async function addToWatch() {
    const addr = query.trim();
    if (addr.length < 32) {
      setError("Enter a valid address first.");
      return;
    }
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: addr }),
    });
    load();
  }

  async function removeWatch(addr: string) {
    await fetch(`/api/watchlist?address=${addr}`, { method: "DELETE" });
    load();
  }

  function timeAgo(unix: number): string {
    const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function MonitorPill({ monitor: m }: { monitor: MonitorInfo }) {
    const style =
      m.status === "live"
        ? "text-emerald-300 border-emerald-500/40"
        : m.status === "connecting"
          ? "text-amber-300 border-amber-500/40"
          : "text-slate-500 border-edge";
    return (
      <span
        className={`rounded-full border px-2.5 py-0.5 text-xs ${style}`}
        title={
          m.status === "unconfigured"
            ? "Set STONK_PROGRAM_ID in .env.local once the Stonk program address is public"
            : `last event: ${m.lastEventAt ? timeAgo(Math.floor(m.lastEventAt / 1000)) : "never"} · ${m.launches} launches caught`
        }
      >
        {m.name}: {m.status}
        {m.status === "unconfigured" ? " (awaiting program id)" : ""}
      </span>
    );
  }

  function DevRiskPill({
    score,
    verdict,
  }: {
    score: number | null;
    verdict: string | null;
  }) {
    if (score === null || verdict === null) {
      return (
        <span className="rounded-full border border-edge px-2 py-0.5 text-[10px] text-slate-500 animate-pulse">
          analyzing dev…
        </span>
      );
    }
    const c = verdictColor(verdict);
    return (
      <span
        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${c.text} ${c.bg} ${c.border}`}
        title={`${verdict} — score ${score}/100 (click the dev address for the full report)`}
      >
        {verdict === "Likely Rugged"
          ? "🚨"
          : verdict === "Suspicious"
            ? "⚠"
            : "✓"}{" "}
        dev {score}/100
      </span>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero + search */}
      <section className="text-center space-y-4 pt-6">
        <h1 className="text-3xl sm:text-4xl font-bold">
          Is this dev <span className="text-emerald-300">legit</span> — or{" "}
          <span className="text-red-300">about to rug</span> you?
        </h1>
        <p className="text-slate-400 max-w-xl mx-auto">
          Paste any Solana wallet that launched tokens (e.g. on pump.fun).
          BigBrother scans its on-chain history and scores the rug risk.
        </p>
        <form onSubmit={submit} className="flex max-w-2xl mx-auto gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Solana wallet address, e.g. 7xKX…gP2n"
            className="mono flex-1 rounded-lg border border-edge bg-panel px-4 py-3 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white hover:brightness-110"
          >
            Scan
          </button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          onClick={addToWatch}
          className="text-xs text-slate-400 hover:text-slate-200 underline"
        >
          + add this wallet to watchlist instead
        </button>
      </section>

      {/* Monitor status + live launches */}
      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">
            <span className="relative inline-flex h-2 w-2 mr-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
            </span>
            Live launches
          </h2>
          <div className="flex flex-wrap gap-2">
            {monitors.map((m) => (
              <MonitorPill key={m.id} monitor={m} />
            ))}
          </div>
        </div>
        <div ref={launchesRef}>
          {launches.length === 0 ? (
            <p className="text-sm text-slate-500">
              Waiting for the next launch… the monitor is watching the chains
              in real time (pump.fun via websocket + 45s safety poller).
            </p>
          ) : (
            <ul className="space-y-2 max-h-96 overflow-y-auto">
              {launches.map((l) => (
                <li
                  key={l.signature}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-edge bg-bg px-3 py-2 text-sm"
                >
                  <span>🚀</span>
                  <span className="font-semibold">
                    {l.symbol ?? l.name ?? "unnamed"}
                  </span>
                  <span className="text-[10px] uppercase tracking-wide rounded border px-1.5 py-0.5 border-edge text-slate-400">
                    {l.launchpad}
                  </span>
                  <a
                    href={`https://solscan.io/token/${l.mint}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mono text-xs text-slate-400 hover:text-accent"
                  >
                    {l.mint.slice(0, 6)}…{l.mint.slice(-4)}
                  </a>
                  <span className="text-slate-500 text-xs">by</span>
                  <a
                    href={`/wallet/${l.dev}`}
                    className="mono text-xs text-accent hover:underline"
                  >
                    dev {l.dev.slice(0, 4)}…{l.dev.slice(-4)}
                  </a>
                  <DevRiskPill score={l.devScore} verdict={l.devVerdict} />
                  <span className="ml-auto text-xs text-slate-600">
                    {timeAgo(l.blockTime)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Watchlist */}
        <section className="panel">
          <h2 className="font-semibold mb-4">Watchlist ({watchlist.length})</h2>
          {watchlist.length === 0 ? (
            <p className="text-sm text-slate-500">
              No wallets tracked yet. Add one above, then scan it to see its risk
              report here.
            </p>
          ) : (
            <ul className="space-y-2">
              {watchlist.map((w) => (
                <li
                  key={w.address}
                  className="flex items-center justify-between rounded-lg border border-edge bg-bg px-3 py-2"
                >
                  <a
                    href={`/wallet/${w.address}`}
                    className="mono text-sm hover:text-accent"
                  >
                    {w.address.slice(0, 6)}…{w.address.slice(-6)}
                  </a>
                  <button
                    onClick={() => removeWatch(w.address)}
                    className="text-xs text-slate-500 hover:text-red-400"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Activity feed */}
        <section className="panel">
          <h2 className="font-semibold mb-4">
            Activity feed
            <span className="ml-2 text-xs text-slate-500">
              (refreshes every 6s)
            </span>
          </h2>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing yet — scan a wallet and results will appear here.
            </p>
          ) : (
            <ul className="space-y-2 max-h-80 overflow-y-auto">
              {events.map((ev) => {
                const c = verdictColor(ev.verdict ?? "");
                return (
                  <li
                    key={ev.id}
                    className="flex items-start gap-3 rounded-lg border border-edge bg-bg px-3 py-2 text-sm"
                  >
                    <span className="mt-0.5">
                      {ev.kind === "flag" ? "🚩" : ev.kind === "watch" ? "👁️" : ev.kind === "launch" ? "🚀" : "🔍"}
                    </span>
                    <div className="flex-1">
                      <span className={c.text}>{ev.message}</span>
                      <div className="text-xs text-slate-600">
                        {new Date(ev.createdAt * 1000).toLocaleString()}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
