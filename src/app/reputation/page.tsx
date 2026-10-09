"use client";

import { useCallback, useEffect, useState } from "react";
import { verdictColor } from "@/components/indicators";
import type { LaunchItem } from "@/lib/types";

interface Stats {
  totalLaunches: number;
  uniqueDevs: number;
  last24h: number;
  last7d: number;
  last30d: number;
}

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

interface VerdictStat {
  verdict: string;
  count: number;
}

type FilterType = "all" | "called" | "proven" | "good" | "unknown" | "farmer";

export default function ReputationPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [launchesPerDay, setLaunchesPerDay] = useState<DailyLaunch[]>([]);
  const [launches, setLaunches] = useState<LaunchItem[]>([]);
  const [filteredLaunches, setFilteredLaunches] = useState<LaunchItem[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [verdictStats, setVerdictStats] = useState<VerdictStat[]>([]);

  const load = useCallback(async () => {
    try {
      const [statsRes, launchesRes] = await Promise.all([
        fetch("/api/stats").then((r) => r.json()),
        fetch("/api/feed").then((r) => r.json()),
      ]);
      setStats(statsRes.stats);
      setLaunchesPerDay(statsRes.launchesPerDay ?? []);
      setVerdictStats(statsRes.verdictStats ?? []);
      setLaunches(launchesRes.launches ?? []);
    } catch (err) {
      console.error("Failed to load reputation data:", err);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!launches) return;
    let filtered = launches;
    if (filter === "called") {
      filtered = launches.filter((l) => l.devVerdict !== null);
    } else if (filter === "proven") {
      filtered = launches.filter((l) => l.devVerdict === "Legit");
    } else if (filter === "good") {
      filtered = launches.filter(
        (l) => l.devVerdict === "Legit" || l.devVerdict === "Suspicious"
      );
    } else if (filter === "unknown") {
      filtered = launches.filter((l) => l.devVerdict === null);
    } else if (filter === "farmer") {
      filtered = launches.filter((l) => l.devVerdict === "Likely Rugged");
    }
    setFilteredLaunches(filtered);
  }, [launches, filter]);

  function timeAgo(unix: number): string {
    const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  const chartData = useCallback(() => {
    if (!launchesPerDay.length) return { dates: [], pumpfun: [], stonkfun: [] };

    // Group by date
    const grouped = launchesPerDay.reduce(
      (acc, curr) => {
        if (!acc[curr.date]) {
          acc[curr.date] = { pumpfun: 0, stonkfun: 0 };
        }
        if (curr.launchpad === "pumpfun") {
          acc[curr.date].pumpfun += curr.count;
        } else if (curr.launchpad === "stonkfun") {
          acc[curr.date].stonkfun += curr.count;
        }
        return acc;
      },
      {} as Record<string, { pumpfun: number; stonkfun: number }>
    );

    const dates = Object.keys(grouped).sort();
    const pumpfun = dates.map((d) => grouped[d].pumpfun);
    const stonkfun = dates.map((d) => grouped[d].stonkfun);

    return { dates, pumpfun, stonkfun };
  }, [launchesPerDay]);

  const chart = chartData();
  const maxCount = Math.max(...chart.pumpfun, ...chart.stonkfun, 1);

  const getVerdictCount = (verdict: string) => {
    const stat = verdictStats.find((s) => s.verdict === verdict);
    return stat ? stat.count : 0;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <section className="text-center space-y-3 pt-6">
        <h1 className="text-4xl sm:text-5xl font-bold">Who launched it?</h1>
        <p className="text-slate-400 max-w-3xl mx-auto text-sm">
          Every new coin on pump.fun and StonkFun, tagged by the dev's track record: past
          launches, best ATH, and how many of their coins pulled real fees.
        </p>
      </section>

      {/* Stats Overview */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="panel text-center space-y-1">
          <div className="text-sm text-slate-400">Launches</div>
          <div className="text-3xl font-bold">{stats?.totalLaunches.toLocaleString() ?? "..."}</div>
          <div className="text-xs text-slate-500 space-x-3">
            <span>24h: {stats?.last24h ?? 0}</span>
            <span>7d: {stats?.last7d ?? 0}</span>
            <span>30d: {stats?.last30d ?? 0}</span>
          </div>
        </div>

        <div className="panel text-center space-y-1">
          <div className="text-sm text-slate-400">Devs ranked</div>
          <div className="text-3xl font-bold">{stats?.uniqueDevs.toLocaleString() ?? "..."}</div>
          <div className="text-xs text-slate-500">unique developer wallets</div>
        </div>

        <div className="panel text-center space-y-1">
          <div className="text-sm text-slate-400">Callouts</div>
          <div className="text-3xl font-bold">{getVerdictCount("Likely Rugged").toLocaleString()}</div>
          <div className="text-xs text-slate-500">bot warming up</div>
        </div>
      </section>

      {/* Launches per day chart */}
      <section className="panel space-y-4">
        <div>
          <h2 className="font-semibold text-sm">Launches per day</h2>
          <p className="text-xs text-slate-500">
            Last 90 days · this week{" "}
            {stats && (
              <>
                {Math.floor(stats.last7d / 7).toLocaleString()} pump.fun + 0 StonkFun a
                day
              </>
            )}
          </p>
        </div>

        {/* Chart */}
        <div className="relative h-48 flex items-end gap-[2px]">
          {chart.dates.map((date, i) => {
            const pumpHeight = (chart.pumpfun[i] / maxCount) * 100;
            const stonkHeight = (chart.stonkfun[i] / maxCount) * 100;
            const totalHeight = Math.max(pumpHeight + stonkHeight, 2);

            return (
              <div
                key={date}
                className="flex-1 flex flex-col-reverse gap-[1px] group relative"
                style={{ height: `${totalHeight}%`, minHeight: "2px" }}
              >
                <div
                  className="bg-emerald-500/70 hover:bg-emerald-500 transition-colors"
                  style={{ height: `${pumpHeight}%` }}
                />
                <div
                  className="bg-blue-500/70 hover:bg-blue-500 transition-colors"
                  style={{ height: `${stonkHeight}%` }}
                />
                <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-panel border border-edge rounded px-2 py-1 text-xs whitespace-nowrap pointer-events-none z-10">
                  {date}
                  <br />
                  {chart.pumpfun[i]} pump.fun
                  <br />
                  {chart.stonkfun[i]} StonkFun
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-emerald-500 rounded" />
            <span>pump.fun</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded" />
            <span>StonkFun</span>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="panel space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === "all"
                ? "bg-accent border-accent text-white"
                : "border-edge text-slate-400 hover:border-slate-400"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter("called")}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === "called"
                ? "bg-accent border-accent text-white"
                : "border-edge text-slate-400 hover:border-slate-400"
            }`}
          >
            Called
          </button>
          <button
            onClick={() => setFilter("proven")}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === "proven"
                ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                : "border-emerald-500/20 text-emerald-400/60 hover:border-emerald-500/40"
            }`}
          >
            Proven dev
          </button>
          <button
            onClick={() => setFilter("good")}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === "good"
                ? "bg-blue-500/20 border-blue-500/40 text-blue-300"
                : "border-blue-500/20 text-blue-400/60 hover:border-blue-500/40"
            }`}
          >
            Good dev
          </button>
          <button
            onClick={() => setFilter("unknown")}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === "unknown"
                ? "bg-slate-500/20 border-slate-500/40 text-slate-300"
                : "border-slate-500/20 text-slate-400/60 hover:border-slate-500/40"
            }`}
          >
            Unknown dev
          </button>
          <button
            onClick={() => setFilter("farmer")}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === "farmer"
                ? "bg-red-500/20 border-red-500/40 text-red-300"
                : "border-red-500/20 text-red-400/60 hover:border-red-500/40"
            }`}
          >
            Farmer
          </button>
          <div className="ml-auto flex gap-2 items-center">
            <span className="text-xs text-slate-500">All</span>
            <span className="text-xs text-slate-500">pump.fun</span>
            <span className="text-xs text-slate-500">StonkFun</span>
            <span className="text-xs text-slate-500">Pons</span>
            <span className="text-xs text-slate-600">SOON</span>
          </div>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[auto,1fr,auto,auto,auto] gap-4 px-4 py-2 text-xs text-slate-500 border-b border-edge">
          <div>COIN</div>
          <div>DEV</div>
          <div>MCAP</div>
          <div>CALLOUT</div>
          <div></div>
        </div>

        {/* Launch list */}
        <div className="space-y-1 max-h-[600px] overflow-y-auto">
          {filteredLaunches.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              {filter === "all" ? "Waiting for launches..." : `No ${filter} launches yet.`}
            </div>
          ) : (
            filteredLaunches.map((l) => {
              const c = l.devVerdict ? verdictColor(l.devVerdict) : null;
              return (
                <div
                  key={l.signature}
                  className="grid grid-cols-[auto,1fr,auto,auto,auto] gap-4 px-4 py-3 items-center hover:bg-raise transition-colors border-b border-edge/50"
                >
                  {/* Coin */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-xs">
                      {(l.symbol ?? l.name ?? "?")[0]}
                    </div>
                    <div>
                      <div className="font-semibold text-sm">
                        {l.symbol ?? l.name ?? "unnamed"}
                      </div>
                      <a
                        href={`https://solscan.io/token/${l.mint}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono text-xs text-slate-500 hover:text-accent"
                      >
                        ${l.symbol ?? "???"}
                      </a>
                    </div>
                  </div>

                  {/* Dev */}
                  <div className="flex items-center gap-2">
                    {l.devVerdict === null ? (
                      <span className="inline-flex items-center gap-1 text-slate-500 text-xs">
                        <span className="inline-block w-1.5 h-1.5 bg-slate-500 rounded-full animate-pulse" />
                        CHECKING
                      </span>
                    ) : l.devVerdict === "Likely Rugged" ? (
                      <span className="text-red-300 text-xs">⚠️</span>
                    ) : l.devVerdict === "Legit" ? (
                      <span className="text-emerald-300 text-xs">✓</span>
                    ) : (
                      <span className="text-amber-300 text-xs">⚠</span>
                    )}
                    <a
                      href={`/wallet/${l.dev}`}
                      className="mono text-xs text-slate-400 hover:text-accent"
                    >
                      {l.dev.slice(0, 4)}…{l.dev.slice(-4)}
                    </a>
                    {l.devVerdict && (
                      <span className="text-xs text-slate-600">
                        reading wallet history...
                      </span>
                    )}
                  </div>

                  {/* MCAP */}
                  <div className="text-sm text-slate-400">
                    {l.devScore ? (
                      <span className={c?.text}>
                        ${(l.devScore * 1000).toLocaleString()}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </div>

                  {/* Callout */}
                  <div>
                    {l.devVerdict && l.devScore !== null ? (
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${c?.text} ${c?.bg} ${c?.border}`}
                      >
                        {l.devVerdict === "Likely Rugged" && "🚨"}
                        {l.devVerdict === "Suspicious" && "⚠"}
                        {l.devVerdict === "Legit" && "✓"} {l.devScore}/100
                      </span>
                    ) : (
                      <span className="text-xs text-slate-600">—</span>
                    )}
                  </div>

                  {/* Time */}
                  <div className="text-xs text-slate-600">{timeAgo(l.blockTime)}</div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
