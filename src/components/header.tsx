"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePoll } from "@/lib/use-poll";

function mcap(n: number | null) {
  if (n === null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

const NAV = [
  { label: "Live", href: "/" },
  { label: "Terminal", href: "/terminal" },
  { label: "Devs", href: "/devs" },
  { label: "X commands", href: "/x-commands" },
  { label: "How it works", href: "/how" },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [token, setToken] = useState<{ mint: string; symbol: string; mcap: number | null } | null>(null);

  // the project's own coin; nothing is shown until TOKEN_MINT is set in .env
  usePoll(
    () =>
      fetch("/api/token")
        .then((r) => r.json())
        .then((d) => setToken(d.token ?? null))
        .catch(() => {}),
    30_000,
    []
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const addr = q.trim();
    if (addr.length >= 32) router.push(`/wallet/${addr}`);
  }

  return (
    <header className="sticky top-0 z-20 bg-bg/95">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
        <Link href="/" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-sm.jpg" alt="" width={32} height={32} className="h-8 w-8 rounded-md shadow-glow-sm" />
          <span className="mono cursor text-[15px] font-semibold uppercase tracking-[0.22em]">FadeTheDev</span>
        </Link>
        <nav className="mono flex flex-wrap gap-1 text-[12.5px] uppercase tracking-[0.14em] text-zinc-400">
          {NAV.map((n) => {
            const active = n.href === pathname;
            return (
              <Link
                key={n.label}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3.5 py-2.5 transition-colors hover:text-matrix ${
                  active ? "bg-matrix/10 text-matrix shadow-[inset_0_-1px_0_0_rgba(45,255,143,0.7)]" : ""
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <form onSubmit={submit} className="relative min-w-[220px] flex-1">
          <span aria-hidden="true" className="mono pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-matrix">
            &gt;
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search by ticker, coin, wallet or link"
            placeholder="ticker, coin, wallet or link"
            className="mono h-10 w-full rounded-[10px] border border-line bg-panel pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-zinc-500 focus:border-matrix/60"
          />
        </form>
        {token && (
          <a
            href={`https://pump.fun/coin/${token.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            title={`$${token.symbol} market cap`}
            className="mono flex h-10 items-center gap-2.5 rounded-[10px] bg-zinc-100 px-4 text-sm text-bg"
          >
            <b className="font-bold">${token.symbol}</b>
            <span className="text-zinc-600">MC</span>
            <span className="font-semibold">{mcap(token.mcap)}</span>
          </a>
        )}
      </div>
      {/* a line of light under the bar, with a slow sweep across it */}
      <div className="relative h-px overflow-hidden bg-gradient-to-r from-transparent via-matrix/40 to-transparent">
        <div className="absolute inset-y-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-matrix to-transparent motion-reduce:hidden" />
      </div>
    </header>
  );
}
