"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { WalletReport, TokenReport } from "@/lib/types";
import {
  VerdictBadge,
  ScoreGauge,
  SignalRow,
  statusStyle,
  verdictColor,
} from "@/components/indicators";

export default function WalletPage() {
  const { address } = useParams<{ address: string }>();
  const [report, setReport] = useState<WalletReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/analyze?wallet=${encodeURIComponent(String(address))}${refresh ? "&refresh=1" : ""}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setReport(json as WalletReport);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [address]
  );

  useEffect(() => {
    fetchReport(false);
  }, [fetchReport]);

  if (loading) {
    return (
      <div className="panel text-center py-16">
        <div className="text-4xl mb-4 animate-pulse">👁️</div>
        <p className="font-semibold">FadeTheDev is watching this wallet…</p>
        <p className="mt-2 text-sm text-slate-500">
          Scanning on-chain history, bonding curves and DexScreener — this can
          take up to a minute on the free public RPC.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel border-red-500/40">
        <p className="text-red-300 font-semibold">Analysis failed</p>
        <p className="mt-2 text-sm text-slate-400">{error}</p>
        <button
          onClick={() => fetchReport(true)}
          className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!report) return null;
  const c = verdictColor(report.verdict);
  const verdictLine =
    report.verdict === "Likely Rugged"
      ? "Multiple rugs or strong rug patterns detected. Ape with extreme caution."
      : report.verdict === "Suspicious"
        ? "Mixed signals. Some red flags on this wallet's history."
        : "No strong rug indicators found. Still do your own research.";

  return (
    <div className="space-y-6">
      {/* Verdict header */}
      <section className={`panel border ${c.border} ${c.bg}`}>
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ScoreGauge score={report.score} verdict={report.verdict} />
          <div className="flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3">
              <VerdictBadge verdict={report.verdict} />
              {report.cached && (
                <span className="text-xs text-slate-500 border border-edge rounded px-2 py-0.5">
                  cached · <button className="underline hover:text-slate-300" onClick={() => fetchReport(true)}>re-scan</button>
                </span>
              )}
            </div>
            <h1 className="mono mt-3 text-lg break-all">{report.address}</h1>
            <p className="mt-2 text-sm text-slate-400">{verdictLine}</p>
            <a
              href={`https://solscan.io/account/${report.address}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-xs text-accent hover:underline"
            >
              view on Solscan ↗
            </a>
          </div>
        </div>
      </section>

      {/* Profile stats */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="SOL balance" value={report.profile.solBalance.toFixed(2)} />
        <Stat label="Recent txs" value={String(report.profile.txCount)} />
        <Stat label="Tokens launched" value={String(report.tokens.length)} />
        <Stat
          label="Rugged tokens"
          value={String(report.tokens.filter((t) => t.status === "RUGGED").length)}
          danger={report.tokens.some((t) => t.status === "RUGGED")}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Signal breakdown */}
        <section className="panel lg:col-span-2">
          <h2 className="font-semibold mb-2">Why this verdict</h2>
          <p className="text-xs text-slate-500 mb-2">
            Each signal adds risk points (higher = riskier).
          </p>
          {report.signals.map((s) => (
            <SignalRow key={s.id} id={s.id} points={s.points} max={s.max} detail={s.detail} />
          ))}
        </section>

        {/* Tokens */}
        <section className="lg:col-span-3 space-y-4">
          <h2 className="font-semibold">
            Tokens launched ({report.tokens.length})
            <span className="ml-2 text-xs text-slate-500">
              (showing up to 10 most recent pump.fun launches)
            </span>
          </h2>
          {report.tokens.length === 0 ? (
            <div className="panel text-sm text-slate-500">
              No pump.fun launches found in this wallet&apos;s recent history.
              It may be a plain trader, or activity is older than the scanned
              window.
            </div>
          ) : (
            report.tokens.map((t) => <TokenCard key={t.mint} token={t} />)
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="panel py-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${danger ? "text-red-300" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function TokenCard({ token: t }: { token: TokenReport }) {
  const s = statusStyle(t.status);
  return (
    <div className="panel">
      <div className="flex items-center justify-between gap-3">
        <a
          href={`https://solscan.io/token/${t.mint}`}
          target="_blank"
          rel="noreferrer"
          className="mono text-sm hover:text-accent"
        >
          {t.mint.slice(0, 8)}…{t.mint.slice(-6)}
        </a>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>
          {s.label}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Metric label="Dev holds" value={pct(t.devHoldsPercent)} />
        <Metric label="Top 10 hold" value={pct(t.top10Percent)} />
        <Metric label="Liquidity" value={usd(t.liquidityUsd)} />
        <Metric label="24h vol" value={usd(t.volume24hUsd)} />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        {t.devSold && <span className="text-red-300">⚠ dev sold own bag</span>}
        <span>mint/freeze renounced: {Math.round(t.authorityHygiene * 100)}%</span>
        {t.curveComplete === true && <span>curve completed</span>}
        {t.curveDrained === true && (
          <span className="text-red-300">curve drained (never graduated!)</span>
        )}
        {t.priceChange24h !== null && (
          <span>24h price: {t.priceChange24h > 0 ? "+" : ""}{t.priceChange24h.toFixed(1)}%</span>
        )}
        {t.launchedAt && (
          <span>launched {new Date(t.launchedAt * 1000).toLocaleDateString()}</span>
        )}
        {t.dexUrl && (
          <a href={t.dexUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            DexScreener ↗
          </a>
        )}
      </div>
    </div>
  );
}

function pct(v: number | null): string {
  return v === null ? "?" : `${v.toFixed(1)}%`;
}
function usd(v: number | null): string {
  if (v === null) return "?";
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-edge bg-bg px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}
