import type { Signal, TokenStatus, Verdict } from "../types";

/**
 * BigBrother scoring engine.
 *
 * Pure functions only: takes plain facts about a wallet and its launched
 * tokens, produces per-signal points and a final 0..100 risk score.
 * Higher score = higher rug risk.
 */

export interface TokenFacts {
  status: TokenStatus;
  /** 0..1 — how well authorities are renounced (1 = mint & freeze revoked) */
  authorityHygiene: number;
  /** % of current supply held by the dev wallet (null = unknown) */
  devHoldsPercent: number | null;
  /** % of supply held by the top 10 holders, excluding the curve (null = unknown) */
  top10Percent: number | null;
  /** dev executed a pump.fun `sell` for this mint on-chain */
  devSold: boolean;
  liquidityUsd: number | null;
  curveComplete: boolean | null;
}

export interface ScoringInput {
  tokens: TokenFacts[];
  /** estimated wallet age in days (null = unknown) */
  walletAgeDays: number | null;
  /** days between first and most recent launch (null if <2 launches) */
  launchSpanDays: number | null;
}

const RUGGY_STATUSES: TokenStatus[] = ["RUGGED", "DEAD", "CRASHED"];

function isRuggy(status: TokenStatus): boolean {
  return RUGGY_STATUSES.includes(status);
}

/* ------------------------------- signals -------------------------------- */

export function signalRugRate(tokens: TokenFacts[]): Signal {
  const max = 30;
  const known = tokens;
  if (known.length === 0) {
    return {
      id: "rug_rate",
      points: 0,
      max,
      detail: "No launched tokens found — nothing to measure.",
    };
  }
  const ruggy = known.filter((t) => isRuggy(t.status)).length;
  const rate = ruggy / known.length;
  return {
    id: "rug_rate",
    points: round1(rate * max),
    max,
    detail: `${ruggy} of ${known.length} launched tokens are rugged/dead/crashed (${Math.round(
      rate * 100
    )}%).`,
  };
}

export function signalAuthorityHygiene(tokens: TokenFacts[]): Signal {
  const max = 15;
  if (tokens.length === 0) {
    return {
      id: "authority_hygiene",
      points: 0,
      max,
      detail: "No tokens found — mint/freeze authority unknown.",
    };
  }
  const avg = tokens.reduce((s, t) => s + t.authorityHygiene, 0) / tokens.length;
  const pct = Math.round(avg * 100);
  return {
    id: "authority_hygiene",
    points: round1((1 - avg) * max),
    max,
    detail: `Average authority hygiene across tokens: ${pct}% (mint/freeze authority revoked or transferred away).`,
  };
}

export function signalDevSold(tokens: TokenFacts[]): Signal {
  const max = 15;
  if (tokens.length === 0) {
    return {
      id: "dev_sold",
      points: 0,
      max,
      detail: "No tokens found — dev selling behavior unknown.",
    };
  }
  // evidence: explicit on-chain sell OR holds ~0% of a still-live token
  const live = tokens.filter(
    (t) => (t.status === "LIVE" || t.status === "GRADUATED") && t.devHoldsPercent !== null
  );
  const abandoned = live.filter((t) => t.devHoldsPercent! < 0.5).length;
  const explicitSells = tokens.filter((t) => t.devSold).length;
  const evidence = Math.max(
    live.length > 0 ? abandoned / live.length : 0,
    tokens.length > 0 ? Math.min(explicitSells / tokens.length, 1) : 0
  );
  const bits: string[] = [];
  if (explicitSells > 0) bits.push(`${explicitSells} on-chain sell(s) of own tokens`);
  if (abandoned > 0) bits.push(`${abandoned} live token(s) where dev holds <0.5%`);
  return {
    id: "dev_sold",
    points: round1(evidence * max),
    max,
    detail: bits.length ? `Dev exit evidence: ${bits.join("; ")}.` : "No evidence of dev selling their bags.",
  };
}

export function signalWalletAge(days: number | null): Signal {
  const max = 12;
  if (days === null) {
    return { id: "wallet_age", points: 0, max, detail: "Wallet age unknown." };
  }
  let points = 0;
  if (days < 1) points = max;
  else if (days < 3) points = 9;
  else if (days < 7) points = 6;
  else if (days < 14) points = 3;
  return {
    id: "wallet_age",
    points,
    max,
    detail: `Wallet active for ~${days < 1 ? "<1" : Math.round(days)} day(s). Fresh wallets that instantly launch tokens are a classic rug pattern.`,
  };
}

export function signalVelocity(input: ScoringInput): Signal {
  const max = 10;
  const n = input.tokens.length;
  if (n === 0) {
    return { id: "velocity", points: 0, max, detail: "No launches observed." };
  }
  const span = input.launchSpanDays ?? 7; // assume a week if we only see recent ones
  const perWeek = n / Math.max(span / 7, 0.25);
  let points = 0;
  if (perWeek >= 5) points = max;
  else if (perWeek >= 3) points = 7;
  else if (perWeek >= 2) points = 4;
  else if (n >= 3) points = 2;
  return {
    id: "launch_velocity",
    points,
    max,
    detail: `${n} launch(es) in ~${span < 1 ? "<1" : Math.round(span)} day(s) ≈ ${perWeek.toFixed(1)}/week. Token factories are high risk.`,
  };
}

export function signalConcentration(tokens: TokenFacts[]): Signal {
  const max = 10;
  const known = tokens.filter((t) => t.top10Percent !== null);
  if (known.length === 0) {
    return {
      id: "holder_concentration",
      points: 0,
      max,
      detail: "Holder distribution unknown.",
    };
  }
  const avg = known.reduce((s, t) => s + t.top10Percent!, 0) / known.length;
  let points = 0;
  if (avg >= 80) points = max;
  else if (avg >= 60) points = 7;
  else if (avg >= 40) points = 4;
  else if (avg >= 25) points = 2;
  return {
    id: "holder_concentration",
    points,
    max,
    detail: `Top-10 holders (excl. curve) hold on average ${Math.round(avg)}% of supply.`,
  };
}

export function signalLpStatus(tokens: TokenFacts[]): Signal {
  const max = 8;
  if (tokens.length === 0) {
    return { id: "lp_status", points: 0, max, detail: "No tokens found." };
  }
  const graduated = tokens.filter((t) => t.status === "GRADUATED").length;
  if (graduated > 0) {
    return {
      id: "lp_status",
      points: 0,
      max,
      detail: `${graduated} token(s) graduated to a DEX with live liquidity.`,
    };
  }
  const ruggy = tokens.filter((t) => isRuggy(t.status)).length;
  const rate = ruggy / tokens.length;
  return {
    id: "lp_status",
    points: round1(rate * max),
    max,
    detail: `No token ever graduated to a DEX; ${ruggy}/${tokens.length} are dead or rugged.`,
  };
}

/* -------------------------------- scoring ------------------------------- */

export function computeSignals(input: ScoringInput): Signal[] {
  return [
    signalRugRate(input.tokens),
    signalAuthorityHygiene(input.tokens),
    signalDevSold(input.tokens),
    signalWalletAge(input.walletAgeDays),
    signalVelocity(input),
    signalConcentration(input.tokens),
    signalLpStatus(input.tokens),
  ];
}

export function verdictFor(score: number): Verdict {
  if (score >= 60) return "Likely Rugged";
  if (score >= 30) return "Suspicious";
  return "Legit";
}

export function scoreWallet(input: ScoringInput): {
  score: number;
  verdict: Verdict;
  signals: Signal[];
} {
  const signals = computeSignals(input);
  const raw = signals.reduce((s, sig) => s + sig.points, 0);
  const score = Math.min(100, Math.max(0, round1(raw)));
  return { score, verdict: verdictFor(score), signals };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
