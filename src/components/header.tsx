"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { label: "Live", href: "/" },
  { label: "Terminal", href: "#" },
  { label: "Screener", href: "#" },
  { label: "Devs", href: "/reputation" },
  { label: "Leaderboard", href: "#" },
  { label: "X commands", href: "#" },
  { label: "How it works", href: "#" },
];

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const addr = q.trim();
    if (addr.length >= 32) router.push(`/wallet/${addr}`);
  }

  return (
    <header className="sticky top-0 z-10 border-b border-edge bg-bg/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-bold">
          <span className="text-2xl font-extrabold">B</span>
          BigBrother
        </Link>
        <nav className="flex flex-wrap gap-1 text-[15px] text-zinc-400">
          {NAV.map((n) => {
            const active = n.href === pathname;
            return (
              <Link
                key={n.label}
                href={n.href}
                className={`rounded-lg px-3.5 py-2 hover:text-zinc-100 ${
                  active ? "bg-[#1b1b1e] text-white" : ""
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <form onSubmit={submit} className="min-w-[220px] flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ticker, coin, wallet or link"
            className="h-10 w-full rounded-[10px] border border-[#26262a] bg-panel px-4 text-sm outline-none placeholder:text-zinc-500 focus:border-zinc-500"
          />
        </form>
        <button className="h-10 rounded-[10px] border border-[#26262a] bg-panel px-4 text-sm">
          Alerts off
        </button>
        <button className="h-10 rounded-[10px] bg-white px-4 text-sm font-semibold text-bg">
          Sign in
        </button>
      </div>
    </header>
  );
}
