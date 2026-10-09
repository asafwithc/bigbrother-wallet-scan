"use client";

import { useState } from "react";
import Link from "next/link";
import { TIER_STYLE, tierOf, type Tier } from "@/lib/tiers";
import { TierIcon } from "@/components/tier-icon";
import { Decode, Eyebrow } from "@/components/decode";
import { usePoll } from "@/lib/use-poll";

interface DevRow {
  dev: string;
  launches: number;
  migratedCount: number;
  lastLaunch: number;
  lastMigrated: boolean;
  verdict: string | null;
  risk: number;
  score: number;
  best: { mint: string; symbol: string | null; ath: number | null; fees: number | null } | null;
}

const TABS: { id: string; label: string; tier: Tier | null }[] = [
  { id: "top", label: "Top devs", tier: null },
  { id: "crazy", label: "Crazy dev", tier: "crazy" },
  { id: "proven", label: "Proven dev", tier: "proven" },
  { id: "good", label: "Good dev", tier: "good" },
  { id: "unknown", label: "Unknown dev", tier: "unknown" },
  { id: "farmer", label: "Farmer", tier: "farmer" },
];
const TILES: Tier[] = ["crazy", "proven", "good", "farmer"];
const WINDOWS = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7 days" },
  { id: "3m", label: "3 months" },
] as const;

const fmt = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-5)}`;
function usd(n: number | null | undefined) {
  if (!n) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}
function sol(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K SOL`;
  return `${n.toFixed(n >= 10 ? 1 : 2)} SOL`;
}
function ago(unix: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const GRID = "grid grid-cols-[44px_2.4fr_1.7fr_1fr_1fr_1.1fr_86px] items-center gap-x-4";
const SUB = "mono mt-1 text-xs text-zinc-500";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy wallet address"
      title={done ? "Copied" : "Copy wallet address"}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="rounded p-1 text-zinc-500 hover:text-zinc-200"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {done ? (
          <path d="m3.5 8.5 3 3 6-6.5" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
            <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
          </>
        )}
      </svg>
    </button>
  );
}

export default function DevBoard() {
  const [tab, setTab] = useState("top");
  const [win, setWin] = useState<string>("7d");
  const [sort, setSort] = useState("score");
  const [page, setPage] = useState(1);
  const [devs, setDevs] = useState<DevRow[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  usePoll(
    (alive) =>
      fetch(`/api/devs?tier=${tab}&window=${win}&sort=${sort}&page=${page}`)
        .then((r) => r.json())
        .then((d) => {
          if (!alive()) return;
          setDevs(d.devs ?? []);
          setCounts(d.counts ?? {});
          setTotal(d.total ?? 0);
          setPageSize(d.pageSize ?? 50);
        })
        .catch(() => {}),
    20_000,
    [tab, win, sort, page]
  );

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const winLabel = WINDOWS.find((w) => w.id === win)?.label ?? "";
  const pick = (fn: () => void) => () => {
    fn();
    setPage(1);
    setDevs(null);
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-[320px] flex-1">
          <Eyebrow>dev ledger</Eyebrow>
          <h1 className="mb-3.5 mt-2 text-[40px] font-bold tracking-tight">
            <Decode text="Dev board" />
          </h1>
          <p className="max-w-[660px] text-[17px] leading-normal text-zinc-400">
            The wallets behind the launches, ranked by what they actually did. Devs whose coins
            went somewhere sit at the top. The ones who keep printing coins that go nowhere get
            their own tab: Farmer.
          </p>
        </div>
        <div className="grid w-full max-w-[680px] grid-cols-2 overflow-hidden rounded-[14px] border border-edge bg-panel sm:grid-cols-4">
          {TILES.map((t) => (
            <div key={t} className="border-r border-edge p-5 last:border-r-0">
              <div className="text-sm text-zinc-400">
                {TABS.find((x) => x.tier === t)?.label}
              </div>
              <div
                className="mono mt-2.5 flex items-center gap-2 text-[24px] font-semibold"
                style={{ color: TIER_STYLE[t].color }}
              >
                <TierIcon tier={t} size={20} />
                {fmt(counts[t] ?? 0)}
              </div>
              <div className="mt-2 text-xs text-zinc-500">{winLabel}</div>
            </div>
          ))}
        </div>
      </div>

      <section className="mt-7 overflow-hidden rounded-[14px] border border-edge bg-panel">
        <div className="flex flex-wrap gap-2.5 p-[18px] pb-3 text-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={pick(() => setTab(t.id))}
              className={`flex items-center gap-2 rounded-[9px] border px-3.5 py-2.5 ${
                t.id === tab
                  ? "border-zinc-100 bg-zinc-100 font-medium text-bg"
                  : "border-line text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {t.tier && <TierIcon tier={t.tier} />}
              {t.label}
              <span className="mono text-xs text-zinc-500">{fmt(counts[t.id] ?? 0)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 px-[18px] pb-4 text-sm">
          <label className="flex items-center gap-2 text-zinc-400">
            Sort
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-lg border border-line bg-bg px-3 text-zinc-100"
            >
              <option value="score">Score</option>
              <option value="launches">Launches</option>
              <option value="recent">Last launch</option>
            </select>
          </label>
          <div className="flex gap-1 rounded-[10px] border border-edge bg-bg p-1">
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                onClick={pick(() => setWin(w.id))}
                className={`rounded-lg px-4 py-2 ${w.id === win ? "bg-chip text-white" : "text-zinc-400"}`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1000px]">
            <div className={`${GRID} mono border-t border-edge px-[22px] py-4 text-xs tracking-[0.08em] text-zinc-500`}>
              <span>#</span>
              <span>DEV</span>
              <span>BEST COIN</span>
              <span className="text-right">ATH</span>
              <span className="text-right">LAUNCHES</span>
              <span className="text-right">FEES</span>
              <span className="text-right">SCORE</span>
            </div>
            {devs === null && (
              <div className="border-t border-edge px-[22px] py-8 text-sm text-zinc-500">Loading devs…</div>
            )}
            {devs?.length === 0 && (
              <div className="border-t border-edge px-[22px] py-8 text-sm text-zinc-500">
                No devs in this tier for this window yet.
              </div>
            )}
            {devs?.map((d, i) => {
              const tier = tierOf(d.verdict, d.risk);
              const t = TIER_STYLE[tier];
              return (
                <div key={d.dev} className={`${GRID} border-t border-edge px-[22px] py-3.5`}>
                  <span className="mono text-sm text-zinc-500">{(page - 1) * pageSize + i + 1}</span>
                  <div className="min-w-0">
                    <span
                      className="mono inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs tracking-wider"
                      style={{ color: t.color, background: `${t.color}1f` }}
                    >
                      <TierIcon tier={tier} size={14} />
                      {t.label}
                    </span>
                    <div className="mt-1 flex items-center gap-1 text-[13px] text-zinc-400">
                      <Link href={`/wallet/${d.dev}`} className="mono hover:text-white">
                        {short(d.dev)}
                      </Link>
                      <CopyButton text={d.dev} />
                      <span>· last launch {ago(d.lastLaunch)}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    {d.best ? (
                      <a
                        href={`https://pump.fun/coin/${d.best.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono block truncate font-semibold hover:underline"
                      >
                        ${d.best.symbol ?? "?"}
                      </a>
                    ) : (
                      <div className="mono font-semibold text-zinc-600">—</div>
                    )}
                    <div className={`${SUB} truncate`}>
                      {d.lastMigrated ? "last launch migrated" : "best coin"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mono font-semibold">{usd(d.best?.ath)}</div>
                    <div className={SUB}>best ATH</div>
                  </div>
                  <div className="text-right">
                    <div className="mono font-semibold">{fmt(d.launches)}</div>
                    <div className="mono mt-1 text-xs" style={{ color: d.migratedCount > 0 ? "#34d399" : "#5a8470" }}>
                      {fmt(d.migratedCount)} migrated
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mono font-semibold">{sol(d.best?.fees)}</div>
                    <div className={SUB}>top coin fees</div>
                  </div>
                  <div>
                    <div className="mono text-right font-semibold">{d.score}</div>
                    <div className="mt-1.5 h-[3px] rounded bg-chip">
                      <div className="h-full rounded" style={{ width: `${d.score}%`, background: t.color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-[22px] py-4 text-sm text-zinc-400">
          <span>
            {total === 0
              ? "0 devs"
              : `${fmt((page - 1) * pageSize + 1)}–${fmt(Math.min(page * pageSize, total))} of ${fmt(total)} devs`}
          </span>
          <div className="flex items-center gap-2">
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
