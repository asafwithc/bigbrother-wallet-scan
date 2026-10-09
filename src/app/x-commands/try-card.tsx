"use client";

import { useState } from "react";
import Link from "next/link";
import type { CoinCard } from "@/lib/card";
import { TIER_STYLE } from "@/lib/tiers";
import { TierIcon } from "@/components/tier-icon";

const fmt = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 5)}…${a.slice(-5)}`;
function usd(n: number | null) {
  if (n === null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function Icon({ src, mint, symbol }: { src: string | null; mint: string; symbol: string }) {
  // Jupiter's icon first, then pump.fun's own image, then a letter tile
  const sources = [
    src,
    mint.endsWith("pump") ? `https://images.pump.fun/coin-image/${mint}?imageSize=128` : null,
  ].filter((u): u is string => !!u);
  const [failed, setFailed] = useState(0);
  if (failed >= sources.length)
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-[#26262a] text-lg font-bold text-zinc-300">
        {(symbol || "?")[0].toUpperCase()}
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      key={sources[failed]}
      src={sources[failed]}
      alt=""
      onError={() => setFailed((n) => n + 1)}
      className="h-12 w-12 shrink-0 rounded-[10px] bg-[#26262a] object-cover"
    />
  );
}

function Card({ c }: { c: CoinCard }) {
  const t = c.tier ? TIER_STYLE[c.tier] : null;
  const facts = [
    c.launchpad,
    c.migrated ? "migrated" : "on the curve",
    c.holders !== null ? `${fmt(c.holders)} holders` : null,
    c.top10 !== null ? `top holders ${c.top10.toFixed(1)}%` : null,
    c.fees !== null ? `${c.fees.toFixed(c.fees >= 10 ? 1 : 2)} SOL fees` : null,
  ].filter(Boolean);
  return (
    <div className="mt-4 rounded-[12px] border border-edge bg-bg p-5">
      <div className="flex items-center gap-3.5">
        <Icon key={c.mint} src={c.icon} mint={c.mint} symbol={c.symbol ?? c.name ?? "?"} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[17px] font-semibold">{c.name ?? c.symbol ?? "unnamed"}</span>
            <span className="mono shrink-0 font-semibold">{usd(c.mcap)}</span>
          </div>
          <div className="mono mt-1 truncate text-[13px] text-zinc-400">
            ${c.symbol ?? "?"} · {facts.join(" · ")}
          </div>
        </div>
      </div>

      <div className="mt-4 border-t border-edge pt-4">
        {c.dev ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {c.tier && t ? (
                <span
                  className="mono inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs tracking-wider"
                  style={{ color: t.color, background: `${t.color}1f` }}
                >
                  <TierIcon tier={c.tier} size={14} />
                  {t.label}
                </span>
              ) : (
                <span className="mono rounded-md bg-[#1b1b1e] px-2 py-1 text-xs tracking-wider text-zinc-400">
                  NOT RATED YET
                </span>
              )}
              <Link href={`/wallet/${c.dev}`} className="mono text-[13px] text-zinc-300 hover:text-white">
                {short(c.dev)}
              </Link>
              {c.score !== null && (
                <span className="mono text-[13px] text-zinc-400">
                  score <b className="text-zinc-100">{c.score}</b>
                </span>
              )}
            </div>
            <div className="mt-2.5 text-[13px] text-zinc-400">
              {c.devLaunches !== null && (
                <span>
                  {fmt(c.devLaunches)} launch{c.devLaunches === 1 ? "" : "es"} ·{" "}
                  <span style={{ color: (c.devMigrations ?? 0) > 0 ? "#34d399" : undefined }}>
                    {fmt(c.devMigrations ?? 0)} migrated
                  </span>
                </span>
              )}
              {c.best && c.best.mint !== c.mint && (
                <span>
                  {c.devLaunches !== null && " · "}best coin{" "}
                  <span className="mono text-zinc-200">${c.best.symbol ?? "?"}</span> ({usd(c.best.ath)} ATH)
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="text-[13px] text-zinc-500">Dev wallet unknown for this coin.</div>
        )}
      </div>
    </div>
  );
}

export function TryCard() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<CoinCard | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/card?q=${encodeURIComponent(q.trim())}`);
      const body = await res.json();
      if (body.card) setCard(body.card);
      else {
        setCard(null);
        setError(body.error ?? "Something went wrong.");
      }
    } catch {
      setCard(null);
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        onSubmit={submit}
        className="mt-4 flex items-center gap-3 rounded-[12px] border border-[#26262a] bg-bg p-1.5 pl-4 focus-within:border-zinc-500"
      >
        <label htmlFor="card-q" className="mono text-[15px] text-zinc-400">
          rep
        </label>
        <input
          id="card-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="contract address or link"
          autoComplete="off"
          spellCheck={false}
          className="mono h-10 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={busy || !q.trim()}
          className="h-10 shrink-0 rounded-[9px] bg-white px-4 text-sm font-semibold text-bg disabled:opacity-50"
        >
          {busy ? "Checking…" : "Get card"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
      {card && <Card c={card} />}
    </>
  );
}
