"use client";

import { useState } from "react";
import Link from "next/link";
import { TIER_STYLE, tierOf } from "@/lib/tiers";
import { usePoll } from "@/lib/use-poll";

interface Coin {
  mint: string;
  name: string | null;
  symbol: string | null;
  launchpad: string;
  dev: string;
  blockTime: number;
  devVerdict: string | null;
  devScore: number | null;
  mcap: number | null;
  ath: number | null;
  volume: number | null;
  migrated: number;
  top10: number | null;
  devHold: number | null;
  devCoins: number;
  copycat: number;
}
interface Stats {
  launches24h: number;
  totalLaunches: number;
  devs: number;
  migrated: number;
  callouts: number;
}
interface DevRow {
  dev: string;
  launches: number;
  lastLaunch: number;
  verdict: string | null;
  risk: number;
  score: number;
  best: { symbol: string | null; ath: number | null } | null;
  migratedCount: number;
}
interface Holders {
  top10: number | null;
  devHold: number | null;
}

const COLUMNS = [
  { id: "new", label: "New launches" },
  { id: "top", label: "Top devs launching" },
  { id: "migrated", label: "Migrated" },
  { id: "callouts", label: "Callouts" },
  { id: "devs", label: "Dev board" },
] as const;
type ColId = (typeof COLUMNS)[number]["id"];

const DEV_TABS = [
  { id: "top", label: "Top" },
  { id: "crazy", label: "Crazy" },
  { id: "proven", label: "Proven" },
  { id: "good", label: "Good" },
  { id: "unknown", label: "New" },
  { id: "farmer", label: "Farmers" },
] as const;

const fmt = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-5)}`;
function usd(n: number | null | undefined) {
  if (n == null) return "–";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
const pct = (n: number | null | undefined) => (n == null ? "–" : `${n.toFixed(1)}%`);
function ago(unix: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function Avatar({ mint, symbol }: { mint: string; symbol: string }) {
  const [bad, setBad] = useState(false);
  const src = mint.endsWith("pump")
    ? `https://images.pump.fun/coin-image/${mint}?imageSize=128`
    : null;
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

// Holder shares (T10, DH) come with each row from the market scanner. Rows used
// to ask Solana for them one by one, which competed with the launch monitor
// for the same rate-limited public node.
function CoinRow({ c, pumpLink }: { c: Coin; pumpLink?: boolean }) {
  const h: Holders = { top10: c.top10, devHold: c.devHold };
  const name = c.name ?? c.symbol ?? "unnamed";
  const tier = tierOf(c.devVerdict, c.devScore);
  const style = TIER_STYLE[tier];
  const belowAth = c.ath != null && c.mcap != null && c.mcap < c.ath * 0.5;
  return (
    <div className="flex gap-3 border-t border-edge px-4 py-3.5">
      <Avatar mint={c.mint} symbol={c.symbol ?? name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold">{name}</span>
          <span className="mono shrink-0 font-semibold">{usd(c.mcap)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[13px] text-zinc-400">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="mono truncate">${c.symbol ?? "?"}</span>
            <span className="mono">{ago(c.blockTime)}</span>
            {c.launchpad === "stonk" && (
              <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#16233d", color: "#5b9bff" }}>
                Stonk
              </span>
            )}
            {c.migrated === 1 && (
              <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#10261e", color: "#34d399" }}>
                migrated
              </span>
            )}
            {c.copycat === 1 && (
              <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: "#2a1616", color: "#f87171" }}>
                copy cat
              </span>
            )}
          </span>
          <span className={`mono shrink-0 text-xs text-zinc-500 ${belowAth ? "line-through" : ""}`}>
            ATH {usd(c.ath)}
          </span>
        </div>
        <div className="mono mt-1.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
          <span title="24h volume">V {usd(c.volume)}</span>
          <span title="Share of supply held by the 10 largest wallets">T10 {pct(h.top10)}</span>
          <span title="Share of supply the dev still holds">DH {pct(h.devHold)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-zinc-400">
          {c.devVerdict === null ? (
            <span className="mono text-xs tracking-wider text-zinc-500">● CHECKING</span>
          ) : (
            <span className="mono text-xs tracking-wider" style={{ color: style.color }}>
              ● {style.label}
            </span>
          )}
          <Link href={`/wallet/${c.dev}`} className="mono text-xs hover:text-white">
            {short(c.dev)}
          </Link>
          <span className="text-xs">
            {c.devVerdict === null
              ? "checking dev…"
              : c.devCoins <= 1
                ? "first launch"
                : `${c.devCoins} coins`}
          </span>
        </div>
        {pumpLink && c.launchpad === "pumpfun" && (
          <a
            href={`https://pump.fun/coin/${c.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block rounded-lg border border-line px-2.5 py-1 text-xs text-zinc-300 hover:border-zinc-500"
          >
            Open on pump.fun ↗
          </a>
        )}
      </div>
    </div>
  );
}

function Panel({
  title,
  sub,
  count,
  children,
}: {
  title: string;
  sub: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-[calc(100vh-170px)] min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[14px] border border-edge bg-panel">
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <i className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            {title}
          </h2>
          {count !== undefined && <span className="mono text-xs text-zinc-500">{fmt(count)}</span>}
        </div>
        <p className="mt-1.5 text-[13px] text-zinc-500">{sub}</p>
      </div>
      {children}
    </section>
  );
}

function CoinList({
  coins,
  hide,
  empty,
  pumpLink,
}: {
  coins: Coin[];
  hide: boolean;
  empty: string;
  pumpLink?: boolean;
}) {
  const rows = hide
    ? coins.filter((c) => !c.copycat && tierOf(c.devVerdict, c.devScore) !== "farmer")
    : coins;
  return (
    <div className="flex-1 overflow-y-auto">
      {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-zinc-500">{empty}</div>}
      {rows.map((c) => (
        <CoinRow key={c.mint} c={c} pumpLink={pumpLink} />
      ))}
    </div>
  );
}

function HideToggle({ on, set }: { on: boolean; set: (v: boolean) => void }) {
  return (
    <div className="flex justify-end px-4 pb-3">
      <button
        onClick={() => set(!on)}
        className={`rounded-lg border px-3 py-1.5 text-[13px] ${
          on ? "border-zinc-100 bg-zinc-100 text-bg" : "border-line text-zinc-300 hover:border-zinc-500"
        }`}
      >
        Hide copycats &amp; farmers
      </button>
    </div>
  );
}

export default function Terminal() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [cols, setCols] = useState<Record<string, Coin[]>>({});
  const [shown, setShown] = useState<Record<ColId, boolean>>({
    new: true,
    top: true,
    migrated: true,
    callouts: true,
    devs: true,
  });
  const [hideNew, setHideNew] = useState(false);
  const [hideMig, setHideMig] = useState(false);
  const [devTab, setDevTab] = useState("top");
  const [devWin, setDevWin] = useState("24h");
  const [devs, setDevs] = useState<DevRow[]>([]);
  const [devCounts, setDevCounts] = useState<Record<string, number>>({});

  usePoll(
    () =>
      fetch("/api/terminal")
        .then((r) => r.json())
        .then((d) => {
          setStats(d.stats);
          setCols({
            new: d.newLaunches ?? [],
            top: d.topDevCoins ?? [],
            migrated: d.migrated ?? [],
            callouts: d.callouts ?? [],
          });
        })
        .catch(() => {}),
    6_000,
    []
  );

  usePoll(
    (alive) =>
      fetch(`/api/devs?tier=${devTab}&window=${devWin}&sort=score`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive()) return;
          setDevs(d.devs ?? []);
          setDevCounts(d.counts ?? {});
        })
        .catch(() => {}),
    15_000,
    [devTab, devWin]
  );

  const visible = COLUMNS.filter((c) => shown[c.id]).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-400">
          <span>
            <b className="mono text-zinc-100">{stats ? fmt(stats.launches24h) : "–"}</b> launches 24h
          </span>
          <span>
            <b className="mono text-zinc-100">{stats ? fmt(stats.devs) : "–"}</b> devs ranked
          </span>
          <span>
            <b className="mono text-zinc-100">{stats ? fmt(stats.migrated) : "–"}</b> migrated
          </span>
          <span>
            <b className="mono text-zinc-100">{stats ? fmt(stats.callouts ?? 0) : "–"}</b> callouts
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {COLUMNS.map((c) => (
            <button
              key={c.id}
              aria-pressed={shown[c.id]}
              onClick={() => setShown((s) => ({ ...s, [c.id]: !s[c.id] }))}
              className={`rounded-[9px] border px-3.5 py-2 ${
                shown[c.id]
                  ? "border-zinc-100 bg-zinc-100 font-medium text-bg"
                  : "border-line text-zinc-400 hover:border-zinc-500"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {visible === 0 && (
        <div className="rounded-[14px] border border-edge bg-panel p-10 text-center text-sm text-zinc-500">
          All columns are hidden. Turn one on with the buttons above.
        </div>
      )}

      <div
        className="grid gap-3.5"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 320px), 1fr))` }}
      >
        {shown.new && (
          <Panel
            title="New launches"
            sub="Every launch, newest first"
            count={stats?.totalLaunches}
          >
            <HideToggle on={hideNew} set={setHideNew} />
            <CoinList coins={cols.new ?? []} hide={hideNew} empty="Waiting for the next launch…" />
          </Panel>
        )}
        {shown.top && (
          <Panel
            title="Top devs launching"
            sub="Crazy, Proven and Good devs' coins still on the curve (launched in the last 24h), biggest first"
          >
            <CoinList coins={cols.top ?? []} hide={false} empty="Nothing here yet." />
          </Panel>
        )}
        {shown.migrated && (
          <Panel
            title="Migrated"
            sub="Coins that completed the bonding curve and now trade on a DEX pool"
            count={stats?.migrated}
          >
            <HideToggle on={hideMig} set={setHideMig} />
            <CoinList coins={cols.migrated ?? []} hide={hideMig} empty="No migrated coins recorded yet." />
          </Panel>
        )}
        {shown.callouts && (
          <Panel
            title="Callouts"
            sub="Latest callouts, newest first"
            count={stats?.callouts}
          >
            <CoinList
              coins={cols.callouts ?? []}
              hide={false}
              empty="No callouts yet."
              pumpLink
            />
          </Panel>
        )}
        {shown.devs && (
          <Panel title="Dev board" sub="Devs who launched recently" count={devCounts[devTab]}>
            <div className="px-4 pb-3">
              <div className="flex flex-wrap gap-x-1 gap-y-1 rounded-[10px] bg-bg p-1 text-[13px]">
                {DEV_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setDevTab(t.id)}
                    className={`rounded-lg px-2.5 py-1.5 ${
                      t.id === devTab ? "bg-chip text-white" : "text-zinc-400"
                    }`}
                  >
                    {t.label}{" "}
                    <span className="mono text-[11px] text-zinc-500">{fmt(devCounts[t.id] ?? 0)}</span>
                  </button>
                ))}
              </div>
              <label className="mt-2.5 block">
                <span className="sr-only">Time window</span>
                <select
                  value={devWin}
                  onChange={(e) => setDevWin(e.target.value)}
                  className="h-9 rounded-lg border border-line bg-bg px-2.5 text-sm text-zinc-100"
                >
                  <option value="24h">24h</option>
                  <option value="7d">7 days</option>
                  <option value="3m">3 months</option>
                </select>
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              {devs.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-zinc-500">No devs in this tier yet.</div>
              )}
              {devs.map((d) => {
                const t = TIER_STYLE[tierOf(d.verdict, d.risk)];
                return (
                  <div key={d.dev} className="flex gap-3 border-t border-edge px-4 py-3.5">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                      style={{ background: `${t.color}26`, color: t.color }}
                    >
                      {t.label[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link href={`/wallet/${d.dev}`} className="mono truncate font-semibold hover:underline">
                          {short(d.dev)}
                        </Link>
                        <span className="mono shrink-0 font-semibold">{usd(d.best?.ath)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[13px] text-zinc-400">
                        <span className="truncate">
                          <span style={{ color: t.color }}>{t.label.toLowerCase()}</span>
                          {d.best && <span className="mono"> · best ${d.best.symbol ?? "?"}</span>}
                        </span>
                        <span className="mono shrink-0 text-xs text-zinc-500">{ago(d.lastLaunch)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-[13px] text-zinc-400">
                        <span>
                          {fmt(d.launches)} launch{d.launches === 1 ? "" : "es"}
                          {d.migratedCount > 0 && (
                            <span style={{ color: "#34d399" }}> · {d.migratedCount} migrated</span>
                          )}
                        </span>
                        <span className="h-[3px] w-14 shrink-0 rounded bg-chip">
                          <span
                            className="block h-full rounded"
                            style={{ width: `${d.score}%`, background: t.color }}
                          />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
