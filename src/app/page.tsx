"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { LaunchItem } from "@/lib/types";

interface Stats {
  totalLaunches: number;
  uniqueDevs: number;
  last24h: number;
  last7d: number;
  last30d: number;
}
interface Daily {
  date: string;
  count: number;
  launchpad: string;
}
interface Meta {
  mcap: number | null;
  image: string | null;
  ath: number | null;
}

const PUMP = "#1fb67a";
const STONK = "#2f6fe4";

const CHIPS = [
  "All",
  "Called",
  "Crazy dev",
  "Proven dev",
  "Good dev",
  "Unknown dev",
  "Farmer",
] as const;
type Chip = (typeof CHIPS)[number];
const SOURCES = ["All", "pump.fun", "StonkFun"] as const;
type Source = (typeof SOURCES)[number];

const fmt = (n: number) => n.toLocaleString("en-US");
function usd(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function ago(unix: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const sourceName = (id: string) => (id === "stonk" ? "StonkFun" : "pump.fun");

function Avatar({ mint, symbol, image }: { mint: string; symbol: string; image: string | null }) {
  const [bad, setBad] = useState(false);
  const src = image ?? (mint.endsWith("pump") ? `https://images.pump.fun/coin-image/${mint}?imageSize=128` : null);
  if (!src || bad)
    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#26262a] font-bold text-zinc-300">
        {(symbol || "?")[0].toUpperCase()}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setBad(true)}
      className="h-11 w-11 shrink-0 rounded-[10px] bg-[#26262a] object-cover"
    />
  );
}

function DevCell({ l, count }: { l: LaunchItem; count: number }) {
  const v = l.devVerdict;
  const badge =
    v === null
      ? { t: "CHECKING", c: "text-zinc-400" }
      : v === "Legit"
        ? { t: "PROVEN DEV", c: "text-emerald-400" }
        : v === "Suspicious"
          ? { t: "CRAZY DEV", c: "text-amber-400" }
          : { t: "FARMER", c: "text-red-400" };
  return (
    <div>
      <div className={`mono flex items-center gap-2 text-xs tracking-wider ${badge.c}`}>
        <span>●</span>
        {badge.t}
        {l.devScore !== null && <span className="text-zinc-500">{Math.round(l.devScore)}/100</span>}
      </div>
      <div className="mt-1 text-[13px] text-zinc-400">
        <Link href={`/wallet/${l.dev}`} className="mono hover:text-white">
          {short(l.dev)}
        </Link>{" "}
        · {v === null ? "reading wallet history…" : `${count} launch${count === 1 ? "" : "es"} in feed`}
      </div>
    </div>
  );
}

export default function Live() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [launches, setLaunches] = useState<LaunchItem[]>([]);
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [chip, setChip] = useState<Chip>("All");
  const [source, setSource] = useState<Source>("All");
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "3m">("24h");

  useEffect(() => {
    const loadStats = () =>
      fetch("/api/stats")
        .then((r) => r.json())
        .then((d) => {
          setStats(d.stats);
          setDaily(d.launchesPerDay ?? []);
        })
        .catch(() => {});
    loadStats();
    const t = setInterval(loadStats, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const load = () =>
      fetch("/api/feed")
        .then((r) => r.json())
        .then((d) => setLaunches(d.launches ?? []))
        .catch(() => {});
    load();
    const t = setInterval(load, 6_000);
    return () => clearInterval(t);
  }, []);

  const mintKey = launches.map((l) => l.mint).join(",");
  useEffect(() => {
    if (!mintKey) return;
    const load = () =>
      fetch(`/api/coins?mints=${mintKey}`)
        .then((r) => r.json())
        .then((d) => setMeta((m) => ({ ...m, ...d.coins })))
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [mintKey]);

  const devCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of launches) c.set(l.dev, (c.get(l.dev) ?? 0) + 1);
    return c;
  }, [launches]);

  const rows = launches.filter((l) => {
    if (source !== "All" && sourceName(l.launchpad) !== source) return false;
    switch (chip) {
      case "Called":
        return false; // callout bot not wired up yet
      case "Crazy dev":
        return l.devVerdict === "Suspicious";
      case "Proven dev":
        return l.devVerdict === "Legit";
      case "Good dev":
        return l.devVerdict === "Legit" && (l.devScore ?? 100) <= 20;
      case "Unknown dev":
        return l.devVerdict === null;
      case "Farmer":
        return l.devVerdict === "Likely Rugged";
      default:
        return true;
    }
  });

  // chart: one stacked bar per day
  const days = useMemo(() => {
    const m = new Map<string, { pump: number; stonk: number }>();
    for (const d of daily) {
      const e = m.get(d.date) ?? { pump: 0, stonk: 0 };
      if (d.launchpad === "stonk") e.stonk += d.count;
      else e.pump += d.count;
      m.set(d.date, e);
    }
    return [...m.entries()].map(([date, v]) => ({ date, ...v }));
  }, [daily]);
  const maxDay = Math.max(1, ...days.map((d) => d.pump + d.stonk));
  const rangeCount = stats
    ? { "24h": stats.last24h, "7d": stats.last7d, "30d": stats.last30d, "3m": stats.totalLaunches }[range]
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[320px] flex-1">
          <h1 className="mb-3.5 mt-3.5 text-[40px] font-bold tracking-tight">Who launched it?</h1>
          <p className="max-w-[680px] text-[17px] leading-normal text-zinc-400">
            Every new coin on pump.fun and StonkFun, tagged by the dev&apos;s track record: past
            launches, best ATH, and how many of their coins pulled real fees.
          </p>
        </div>
        <div className="grid w-full max-w-[680px] grid-cols-3 overflow-hidden rounded-[14px] border border-edge bg-panel">
          <div className="border-r border-edge p-5">
            <div className="text-sm text-zinc-400">Launches</div>
            <div className="mono mt-2.5 text-[26px] font-semibold">
              {rangeCount === null ? "—" : fmt(rangeCount)}
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              {(["24h", "7d", "30d", "3m"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`mono ${r === range ? "font-bold text-white" : "text-zinc-600"}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="border-r border-edge p-5">
            <div className="text-sm text-zinc-400">Devs ranked</div>
            <div className="mono mt-2.5 text-[26px] font-semibold">
              {stats ? fmt(stats.uniqueDevs) : "—"}
            </div>
          </div>
          <div className="p-5">
            <div className="text-sm text-zinc-400">Callouts</div>
            <div className="mono mt-2.5 text-[26px] font-semibold">0</div>
            <div className="mt-2 text-xs text-zinc-500">bot warming up</div>
          </div>
        </div>
      </div>

      <section className="mt-7 rounded-[14px] border border-edge bg-panel p-5">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <div className="text-[17px] font-semibold">Launches per day</div>
            <div className="mt-1.5 text-[13px] text-zinc-400">Last 90 days</div>
          </div>
          <div className="flex items-center gap-4 text-[13px] text-zinc-400">
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: PUMP }} />
              pump.fun
            </span>
            <span className="flex items-center gap-1.5">
              <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STONK }} />
              StonkFun
            </span>
          </div>
        </div>
        <div className="mt-5 flex h-[140px] items-end gap-[3px]">
          {days.length === 0 && <div className="text-sm text-zinc-500">Collecting launches…</div>}
          {days.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${fmt(d.pump + d.stonk)} launches`}
              className="flex h-full flex-1 flex-col justify-end"
            >
              <div style={{ height: `${(d.stonk / maxDay) * 100}%`, background: STONK }} />
              <div style={{ height: `${(d.pump / maxDay) * 100}%`, background: PUMP }} />
            </div>
          ))}
        </div>
        {days.length > 0 && (
          <div className="mono mt-2 flex justify-between text-xs text-zinc-500">
            <span>{days[0].date}</span>
            <span>{days[days.length - 1].date}</span>
          </div>
        )}
      </section>

      <section className="mt-7 overflow-hidden rounded-[14px] border border-edge bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 p-[18px]">
          <div className="flex flex-wrap gap-2.5 text-sm">
            {CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => setChip(c)}
                className={`rounded-[9px] border px-4 py-2.5 ${
                  c === chip
                    ? "border-zinc-100 bg-zinc-100 text-bg"
                    : "border-[#26262a] text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex gap-1 rounded-[10px] border border-edge bg-bg p-1 text-sm">
            {SOURCES.map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={`rounded-lg px-4 py-2 ${s === source ? "bg-[#1b1b1e] text-white" : "text-zinc-400"}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            <div className="mono grid grid-cols-[2fr_3fr_1fr_1fr] border-t border-edge px-[22px] py-4 text-xs tracking-[0.08em] text-zinc-500">
              <span>COIN</span>
              <span>DEV</span>
              <span className="text-right">MCAP</span>
              <span className="text-right">CALLOUT</span>
            </div>
            {rows.length === 0 && (
              <div className="border-t border-edge px-[22px] py-8 text-sm text-zinc-500">
                Waiting for matching launches…
              </div>
            )}
            {rows.map((l) => {
              const m = meta[l.mint];
              const name = l.name ?? l.symbol ?? "unnamed";
              return (
                <div
                  key={l.signature}
                  className="grid grid-cols-[2fr_3fr_1fr_1fr] items-center border-t border-edge px-[22px] py-3.5"
                >
                  <div className="flex items-center gap-3.5">
                    <Avatar mint={l.mint} symbol={l.symbol ?? name} image={m?.image ?? null} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-base font-semibold">
                        <span className="truncate">{name}</span>
                        <span
                          className="rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium"
                          style={
                            l.launchpad === "stonk"
                              ? { background: "#16233d", color: "#5b9bff" }
                              : { background: "#10261e", color: "#34d399" }
                          }
                        >
                          {sourceName(l.launchpad)}
                        </span>
                      </div>
                      <div className="mono mt-1 text-[13px] text-zinc-400">
                        ${l.symbol ?? "?"} · {ago(l.blockTime)}
                      </div>
                    </div>
                  </div>
                  <DevCell l={l} count={devCounts.get(l.dev) ?? 1} />
                  <div className="text-right">
                    <div className="mono text-base font-semibold">{usd(m?.mcap)}</div>
                    <div className="mono mt-1 text-xs text-zinc-500">ATH {usd(m?.ath)}</div>
                  </div>
                  <div className="text-right text-zinc-600">—</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
