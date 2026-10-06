import type { TokenStatus, Verdict } from "@/lib/types";

export function verdictColor(v: Verdict | string): {
  text: string;
  bg: string;
  border: string;
} {
  switch (v) {
    case "Legit":
      return { text: "text-emerald-300", bg: "bg-emerald-500/10", border: "border-emerald-500/40" };
    case "Suspicious":
      return { text: "text-amber-300", bg: "bg-amber-500/10", border: "border-amber-500/40" };
    case "Likely Rugged":
      return { text: "text-red-300", bg: "bg-red-500/10", border: "border-red-500/40" };
    default:
      return { text: "text-slate-300", bg: "bg-slate-500/10", border: "border-slate-500/40" };
  }
}

export function statusStyle(s: TokenStatus): { label: string; cls: string } {
  switch (s) {
    case "GRADUATED":
      return { label: "Graduated", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" };
    case "LIVE":
      return { label: "Live on curve", cls: "bg-sky-500/15 text-sky-300 border-sky-500/30" };
    case "CRASHED":
      return { label: "Crashed −90%+", cls: "bg-orange-500/15 text-orange-300 border-orange-500/30" };
    case "DEAD":
      return { label: "Dead", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" };
    case "RUGGED":
      return { label: "RUGGED", cls: "bg-red-500/15 text-red-300 border-red-500/30" };
  }
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const c = verdictColor(verdict);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${c.text} ${c.bg} ${c.border}`}
    >
      {verdict}
    </span>
  );
}

export function ScoreGauge({ score, verdict }: { score: number; verdict: string }) {
  const c = verdictColor(verdict);
  const r = 52;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circ;
  const stroke =
    verdict === "Likely Rugged" ? "#f87171" : verdict === "Suspicious" ? "#fbbf24" : "#34d399";
  return (
    <div className="relative h-36 w-36 shrink-0">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#1d2735" strokeWidth="10" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circ - filled}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold ${c.text}`}>{Math.round(score)}</span>
        <span className="text-[10px] uppercase tracking-widest text-slate-500">risk</span>
      </div>
    </div>
  );
}

export function SignalRow({
  id,
  points,
  max,
  detail,
}: {
  id: string;
  points: number;
  max: number;
  detail: string;
}) {
  const pct = Math.min(100, (points / max) * 100);
  const bar =
    pct >= 60 ? "bg-red-400" : pct >= 25 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div className="py-3 border-b border-edge last:border-0">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium capitalize">{id.replace(/_/g, " ")}</span>
        <span className="mono text-slate-400">
          {points} / {max} pts
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full rounded bg-edge overflow-hidden">
        <div className={`h-full rounded ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-400">{detail}</p>
    </div>
  );
}
