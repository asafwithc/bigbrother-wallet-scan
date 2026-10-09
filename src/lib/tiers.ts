/**
 * Dev tiers shown in the UI, best to worst, by reputation (100 - risk):
 *   crazy   — reputation 65+
 *   proven  — reputation 57-64
 *   good    — reputation 50-56 (at least one coin that took off)
 *   unknown — only a single launch on record (or not checked yet)
 *   farmer  — 2+ launches and nothing took off
 */
export type Tier = "crazy" | "proven" | "good" | "unknown" | "farmer";

export function tierOf(verdict: string | null, risk: number | null): Tier {
  if (verdict === "Legit") {
    const r = risk ?? 20;
    return r <= 35 ? "crazy" : r <= 43 ? "proven" : "good";
  }
  if (verdict === "Suspicious" || verdict === "Likely Rugged") return "farmer";
  return "unknown";
}

/** SQL conditions for each tier. `v`/`r` are the verdict and risk column names. */
export function tierSql(v: string, r: string): Record<Tier | "top", string> {
  return {
    top: `${v} = 'Legit'`,
    crazy: `${v} = 'Legit' AND ${r} <= 35`,
    proven: `${v} = 'Legit' AND ${r} > 35 AND ${r} <= 43`,
    good: `${v} = 'Legit' AND ${r} > 43`,
    unknown: `(${v} IS NULL OR ${v} = 'Unknown')`,
    farmer: `${v} IN ('Suspicious','Likely Rugged')`,
  };
}

export const TIER_STYLE: Record<Tier, { label: string; color: string }> = {
  crazy: { label: "CRAZY DEV", color: "#facc15" },
  proven: { label: "PROVEN DEV", color: "#34d399" },
  good: { label: "GOOD DEV", color: "#60a5fa" },
  unknown: { label: "UNKNOWN DEV", color: "#a1a1aa" },
  farmer: { label: "FARMER", color: "#f87171" },
};
