"use client";

import { useState } from "react";
import Link from "next/link";
import type { LaunchItem } from "@/lib/types";
import { TIER_STYLE, tierOf } from "@/lib/tiers";
import { Decode, Eyebrow } from "@/components/decode";
import { usePoll } from "@/lib/use-poll";

interface Stats {
  totalLaunches: number;
  uniqueDevs: number;
  called?: number;
  last24h: number;
  last7d: number;
  last30d: number;
}
interface ChartDay {
  date: string;
  pump: number;
  stonk: number;
  pumpMigrated: number | null;
  stonkMigrated: number | null;
  notes: string[];
}
interface Chart {
  days: ChartDay[];
  week: { pump: number; stonk: number } | null;
}
type Row = LaunchItem & {
  devLaunches?: number;
  called?: boolean;
  mcap?: number | null;
  ath?: number | null;
};

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
const CHIP_FILTER: Record<Chip, string> = {
  All: "",
  Called: "called",
  "Crazy dev": "crazy",
  "Proven dev": "proven",
  "Good dev": "good",
  "Unknown dev": "unknown",
  Farmer: "farmer",
};
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
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-chip font-bold text-zinc-300">
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
      className="h-11 w-11 shrink-0 rounded-[10px] bg-chip object-cover"
    />
  );
}

function DevCell({ l, count }: { l: LaunchItem; count: number }) {
  const v = l.devVerdict;
  const tier = TIER_STYLE[tierOf(v, l.devScore)];
  const badge = v === null ? { t: "CHECKING", color: "#a1a1aa" } : { t: tier.label, color: tier.color };
  return (
    <div>
      <div className="mono flex items-center gap-2 text-xs tracking-wider" style={{ color: badge.color }}>
        <span>●</span>
        {badge.t}
        {l.devScore !== null && v !== "Unknown" && <span className="text-zinc-500">{Math.round(100 - l.devScore)}/100</span>}
      </div>
      <div className="mt-1 text-[13px] text-zinc-400">
        <Link href={`/wallet/${l.dev}`} className="mono hover:text-white">
          {short(l.dev)}
        </Link>{" "}
        · {v === null ? "reading wallet history…" : v === "Unknown" ? "first launch we've seen" : `${count} launch${count === 1 ? "" : "es"} in feed`}
      </div>
    </div>
  );
}

const dayLabel = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

function LaunchChart({ chart }: { chart: Chart | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = chart?.days ?? [];
  const n = days.length;
  const max = Math.max(1, ...days.map((d) => d.pump + d.stonk));
  const h = hover !== null ? days[hover] : undefined;
  // four evenly spaced date labels, like the bars above them
  const ticks = n >= 4 ? [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1] : [];

  return (
    <section className="mt-7 rounded-[14px] border border-edge bg-panel p-5">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <div className="text-[17px] font-semibold">Launches per day</div>
          <div className="mt-1.5 text-[13px] text-zinc-400">
            {n > 0 ? `Last ${n} days` : "Launch data"}
            {chart?.week &&
              ` · this week ${fmt(chart.week.pump)} pump.fun + ${fmt(chart.week.stonk)} StonkFun a day`}
          </div>
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

      <div className="relative mt-5" onMouseLeave={() => setHover(null)}>
        <div className="flex h-[140px] items-end gap-[3px]">
          {n === 0 && (
            <div className="text-sm text-zinc-500">
              {chart ? "Launch data is unavailable right now." : "Loading…"}
            </div>
          )}
          {days.map((d, i) => (
            <div
              key={d.date}
              onMouseEnter={() => setHover(i)}
              className="flex h-full flex-1 flex-col justify-end transition-opacity"
              style={{ opacity: hover === null || hover === i ? 1 : 0.4 }}
            >
              <div style={{ height: `${(d.stonk / max) * 100}%`, background: STONK }} />
              <div style={{ height: `${(d.pump / max) * 100}%`, background: PUMP }} />
            </div>
          ))}
        </div>

        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-[250px] max-w-full rounded-[12px] border border-line bg-raise p-4 text-sm shadow-xl"
            style={{
              // beside the hovered bar, but never outside the chart (narrow screens)
              left:
                hover < n / 2
                  ? `clamp(0px, calc(${((hover + 1) / n) * 100}% + 8px), calc(100% - 250px))`
                  : `clamp(0px, calc(${(hover / n) * 100}% - 258px), calc(100% - 250px))`,
            }}
          >
            <div className="font-semibold">{dayLabel(h.date)}</div>
            <div className="mt-2.5 flex items-center justify-between gap-4 text-zinc-300">
              <span className="flex items-center gap-2">
                <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: PUMP }} />
                pump.fun
              </span>
              <span className="mono font-semibold text-zinc-100">{fmt(h.pump)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-4 text-zinc-300">
              <span className="flex items-center gap-2">
                <i className="h-2.5 w-2.5 rounded-[3px]" style={{ background: STONK }} />
                StonkFun
              </span>
              <span className="mono font-semibold text-zinc-100">{fmt(h.stonk)}</span>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-4 border-t border-line pt-2.5">
              <span>Total</span>
              <span className="mono font-semibold">{fmt(h.pump + h.stonk)}</span>
            </div>
            {h.pumpMigrated !== null && (
              <div className="mt-1.5 text-zinc-400">{fmt(h.pumpMigrated)} pump.fun migrated</div>
            )}
            {h.notes.map((note) => (
              <div key={note} className="mt-1.5 text-xs text-zinc-500">
                {note}
              </div>
            ))}
          </div>
        )}
      </div>

      {ticks.length > 0 && (
        <div className="mono mt-2 flex justify-between text-xs text-zinc-500">
          {ticks.map((t) => (
            <span key={t}>{dayLabel(days[t].date)}</span>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Live() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [chart, setChart] = useState<Chart | null>(null);
  const [launches, setLaunches] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [chip, setChip] = useState<Chip>("All");
  const [source, setSource] = useState<Source>("All");
  const [range, setRange] = useState<"24h" | "7d" | "30d" | "3m">("24h");

  usePoll(
    () =>
      fetch("/api/stats")
        .then((r) => r.json())
        .then((d) => {
          setStats(d.stats);
          setChart(d.chart ?? { days: [], week: null });
        })
        .catch(() => {}),
    30_000,
    []
  );

  // market cap and ATH arrive with each row, so there is no second request per refresh
  usePoll(
    (alive) => {
      const qs = new URLSearchParams({ page: String(page) });
      if (chip !== "All") qs.set("filter", CHIP_FILTER[chip]);
      if (source !== "All") qs.set("launchpad", source === "StonkFun" ? "stonk" : "pumpfun");
      return fetch(`/api/feed?${qs}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive()) return;
          setLaunches(d.launches ?? []);
          setTotal(d.total ?? 0);
          setPageSize(d.pageSize ?? 50);
        })
        .catch(() => {});
    },
    6_000,
    [page, chip, source]
  );

  const rows = launches;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  const rangeCount = stats
    ? { "24h": stats.last24h, "7d": stats.last7d, "30d": stats.last30d, "3m": stats.totalLaunches }[range]
    : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[320px] flex-1">
          <Eyebrow>live feed</Eyebrow>
          <h1 className="mb-3.5 mt-2 text-[40px] font-bold tracking-tight">
            <Decode text="Check the dev before you ape." />
          </h1>
          <p className="max-w-[680px] text-[17px] leading-normal text-zinc-400">
            Same wallets, new ticker, same ending. BigBrother watches pump.fun launches as they
            land and puts the dev&apos;s record next to the coin: how many they launched, how many
            went anywhere, and how many they left for dead.
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
            <div className="mono mt-2.5 text-[26px] font-semibold">
              {stats ? fmt(stats.called ?? 0) : "—"}
            </div>
            <div className="mt-2 text-xs text-zinc-500">coins called out</div>
          </div>
        </div>
      </div>

      <LaunchChart chart={chart} />

      <section className="mt-7 overflow-hidden rounded-[14px] border border-edge bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 p-[18px]">
          <div className="flex flex-wrap gap-2.5 text-sm">
            {CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setChip(c);
                  setPage(1);
                }}
                className={`rounded-[9px] border px-4 py-2.5 ${
                  c === chip
                    ? "border-zinc-100 bg-zinc-100 text-bg"
                    : "border-line text-zinc-300 hover:border-zinc-500"
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
                onClick={() => {
                  setSource(s);
                  setPage(1);
                }}
                className={`rounded-lg px-4 py-2 ${s === source ? "bg-chip text-white" : "text-zinc-400"}`}
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
              const name = l.name ?? l.symbol ?? "unnamed";
              return (
                <div
                  key={l.signature}
                  className="grid grid-cols-[2fr_3fr_1fr_1fr] items-center border-t border-edge px-[22px] py-3.5"
                >
                  <div className="flex items-center gap-3.5">
                    <Avatar mint={l.mint} symbol={l.symbol ?? name} image={null} />
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
                  <DevCell l={l} count={l.devLaunches ?? 1} />
                  <div className="text-right">
                    <div className="mono text-base font-semibold">{usd(l.mcap)}</div>
                    <div className="mono mt-1 text-xs text-zinc-500">ATH {usd(l.ath)}</div>
                  </div>
                  {l.called ? (
                    <div
                      className="mono text-right text-xs tracking-wider"
                      style={{ color: TIER_STYLE[tierOf(l.devVerdict, l.devScore)].color }}
                    >
                      CALLED
                    </div>
                  ) : (
                    <div className="text-right text-zinc-600">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-[22px] py-4 text-sm text-zinc-400">
          <span>
            {total === 0
              ? "0 launches"
              : `${fmt((page - 1) * pageSize + 1)}–${fmt(Math.min(page * pageSize, total))} of ${fmt(total)} launches`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="rounded-lg border border-line px-3 py-2 hover:border-zinc-500 disabled:opacity-40"
            >
              Newest
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-lg border border-line px-3 py-2 hover:border-zinc-500 disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="mono px-2">
              {page} / {fmt(pages)}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="rounded-lg border border-line px-3 py-2 hover:border-zinc-500 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
