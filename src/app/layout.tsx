import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "BigBrother — Solana Dev Wallet Tracker",
  description:
    "Analyze Solana developer wallets: legit launchers vs serial ruggers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-edge bg-panel/60 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-2xl">👁️</span>
              <span className="text-xl font-bold tracking-tight">
                Big<span className="text-accent">Brother</span>
              </span>
              <span className="hidden sm:inline text-xs text-slate-500 border border-edge rounded px-2 py-0.5 ml-2">
                dev wallet rug tracker
              </span>
            </Link>
            <nav className="text-sm text-slate-400">
              <Link href="/" className="hover:text-slate-200">
                Dashboard
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-slate-600">
          BigBrother is a research tool. Scores are heuristics, not financial
          advice. Data: Solana public RPC + DexScreener.
        </footer>
      </body>
    </html>
  );
}
