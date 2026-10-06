// Shared types for BigBrother

export type Verdict = "Legit" | "Suspicious" | "Likely Rugged";

/** Classification of a single token launched by the dev */
export type TokenStatus =
  | "GRADUATED" // reached a DEX with healthy liquidity
  | "LIVE" // still on bonding curve with activity
  | "DEAD" // curve abandoned or negligible liquidity
  | "RUGGED" // curve drained / liquidity pulled
  | "CRASHED"; // price collapsed >90%

export interface TokenReport {
  mint: string;
  symbol: string | null;
  launchedAt: number | null; // unix seconds
  status: TokenStatus;
  curveComplete: boolean | null;
  curveDrained: boolean | null;
  devHoldsPercent: number | null; // % of supply currently held by dev
  top10Percent: number | null; // % of supply in top 10 holders
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  dexUrl: string | null;
  /** dev executed a pump.fun `sell` on this token's curve */
  devSold: boolean;
  /** 0..1 — mint/freeze authority renounced (1 = both revoked) */
  authorityHygiene: number;
}

export interface Signal {
  id: string;
  /** points contributed to the risk score (0..max) */
  points: number;
  max: number;
  detail: string;
}

export interface WalletReport {
  address: string;
  score: number; // 0..100, higher = riskier
  verdict: Verdict;
  signals: Signal[];
  tokens: TokenReport[];
  profile: {
    solBalance: number;
    txCount: number;
    firstSeenAt: number | null; // unix seconds, lower bound of wallet age
    ageDaysEstimate: number | null;
  };
  analyzedAt: number; // unix seconds
  cached?: boolean;
}

export interface FeedEvent {
  id: number;
  address: string;
  kind: string; // "scan" | "flag" | "watch" | "launch"
  message: string;
  score: number | null;
  verdict: string | null;
  createdAt: number;
}

/** A token launch caught by the on-chain monitor */
export interface LaunchItem {
  signature: string;
  mint: string;
  launchpad: string;
  name: string | null;
  symbol: string | null;
  dev: string;
  blockTime: number; // unix seconds
  /** live dev risk score, filled in by the background analyzer (null = analyzing) */
  devScore: number | null;
  devVerdict: string | null;
}

export type MonitorStatus = "live" | "connecting" | "offline" | "unconfigured";

export interface MonitorInfo {
  id: string;
  name: string;
  status: MonitorStatus;
  lastEventAt: number | null;
  launches: number;
}
