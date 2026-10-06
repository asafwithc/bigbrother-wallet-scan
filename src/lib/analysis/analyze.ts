import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  rpc,
  lamportsToSol,
  isValidAddress,
  bondingCurveAddress,
} from "../solana";
import {
  scanWalletPumpActivity,
  getCurveState,
  type CurveState,
} from "../sources/pumpfun";
import { getTokenPairStats, type DexPairStats } from "../sources/dexscreener";
import { scoreWallet, type TokenFacts } from "./score";
import { get_cached_report, save_report, add_event } from "../db";
import type { TokenReport, WalletReport, TokenStatus } from "../types";

const MAX_TOKENS_TO_ANALYZE = 10;

/**
 * Full wallet analysis pipeline:
 *  1. cached report? -> return it
 *  2. wallet profile (balance, activity window)
 *  3. scan recent txs for pump.fun create/sell instructions
 *  4. per-token: curve state, holders, dev bag, DexScreener stats
 *  5. classify tokens and feed facts into the scoring engine
 */
export async function analyzeWallet(
  address: string,
  refresh = false
): Promise<WalletReport> {
  if (!isValidAddress(address)) {
    throw new Error("Invalid Solana address");
  }
  if (!refresh) {
    const cached = get_cached_report(address);
    if (cached) return cached;
  }

  const wallet = new PublicKey(address);

  // ---- wallet profile ------------------------------------------------
  const [balanceLamports, sigs] = await Promise.all([
    rpc.getBalance(wallet),
    rpc.getSignaturesForAddress(wallet, { limit: 150 }),
  ]);

  const blockTimes = sigs.map((s) => s.blockTime).filter((t): t is number => !!t);
  const firstSeenAt = blockTimes.length > 0 ? Math.min(...blockTimes) : null;
  const nowSec = Math.floor(Date.now() / 1000);
  const ageDays = firstSeenAt !== null ? (nowSec - firstSeenAt) / 86400 : null;

  // ---- pump.fun activity ----------------------------------------------
  const scan = await scanWalletPumpActivity(wallet, 30);
  const created = scan.createdMints.filter((c) => c.mint !== "unknown");

  // days between first and most recent launch (for velocity)
  const times = created.map((c) => c.blockTime).filter((t): t is number => !!t);
  const launchSpanDays = times.length >= 2
    ? (Math.max(...times) - Math.min(...times)) / 86400
    : null;

  // ---- per-token deep dive ---------------------------------------------
  const recent = created.slice(-MAX_TOKENS_TO_ANALYZE); // sig list is oldest-first; last = newest
  const tokenReports: TokenReport[] = [];
  const tokenFacts: TokenFacts[] = [];

  for (const c of recent) {
    const report = await analyzeToken(
      c.mint,
      address,
      scan.soldMints.has(c.mint),
      c.blockTime
    );
    if (!report) continue;
    tokenReports.push(report);
    tokenFacts.push(toFacts(report));
  }

  // ---- score ------------------------------------------------------------
  const { score, verdict, signals } = scoreWallet({
    tokens: tokenFacts,
    walletAgeDays: ageDays,
    launchSpanDays,
  });

  const report: WalletReport = {
    address,
    score,
    verdict,
    signals,
    tokens: tokenReports.reverse(), // newest first
    profile: {
      solBalance: lamportsToSol(balanceLamports),
      txCount: sigs.length,
      firstSeenAt,
      ageDaysEstimate: ageDays,
    },
    analyzedAt: nowSec,
  };

  save_report(report);
  add_event(
    address,
    verdict === "Likely Rugged" ? "flag" : "scan",
    `Analyzed ${shortAddr(address)} — ${verdict} (${score}/100), ${tokenReports.length} token launch(es) found`,
    score,
    verdict
  );
  return report;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function toFacts(t: TokenReport): TokenFacts {
  return {
    status: t.status,
    authorityHygiene: t.authorityHygiene,
    devHoldsPercent: t.devHoldsPercent,
    top10Percent: t.top10Percent,
    devSold: t.devSold,
    liquidityUsd: t.liquidityUsd,
    curveComplete: t.curveComplete,
  };
}

async function analyzeToken(
  mint: string,
  dev: string,
  devSold: boolean,
  launchedAt: number | null
): Promise<TokenReport | null> {
  let mintPk: PublicKey;
  try {
    mintPk = new PublicKey(mint);
  } catch {
    return null;
  }
  const devPk = new PublicKey(dev);
  const curvePk = await bondingCurveAddress(mintPk);
  const curveAta = getAssociatedTokenAddressSync(mintPk, curvePk, true);

  const [curve, supplyRes, mintInfo, largest, devAccounts, dex] =
    await Promise.all([
      getCurveState(curvePk),
      rpc.getTokenSupply(mintPk).catch(() => null),
      rpc.getParsedAccountInfo(mintPk).catch(() => null),
      rpc.getTokenLargestAccounts(mintPk).catch(() => null),
      rpc.getTokenAccountsByOwner(devPk, mintPk).catch(() => null),
      getTokenPairStats(mint).catch(() => null),
    ]);

  if (!supplyRes) return null;
  const supplyUi = supplyRes.value.uiAmount ?? 0;
  if (supplyUi <= 0) return null;

  // ---- authority hygiene (0..1, 1 = fully renounced) ----------------------
  let authorityHygiene = 0.5; // unknown
  const parsedMint = (
    mintInfo?.value as { parsed?: { info?: Record<string, unknown> } } | null
  )?.parsed;
  if (parsedMint?.info) {
    const mintAuthority = parsedMint.info.mintAuthority as string | null;
    const freezeAuthority = parsedMint.info.freezeAuthority as string | null;
    const mintOk =
      mintAuthority === null || mintAuthority === curvePk.toBase58();
    const freezeOk = freezeAuthority === null;
    authorityHygiene = (mintOk ? 0.5 : 0) + (freezeOk ? 0.5 : 0);
  }

  // ---- holder concentration (exclude bonding curve ATA) -------------------
  let top10Percent: number | null = null;
  if (largest && largest.value.length > 0) {
    const curveStr = curveAta.toBase58();
    const holders = largest.value.filter(
      (a) => a.address.toBase58() !== curveStr && (a.uiAmount ?? 0) > 0
    );
    if (holders.length > 0) {
      const distributed = holders.reduce((s, a) => s + (a.uiAmount ?? 0), 0);
      if (distributed > 0) {
        const top = holders
          .slice(0, 10)
          .reduce((s, a) => s + (a.uiAmount ?? 0), 0);
        top10Percent = (top / distributed) * 100;
      }
    }
  }

  // ---- dev bag -------------------------------------------------------------
  let devHoldsPercent: number | null = null;
  if (devAccounts) {
    const devAmt = devAccounts.value.reduce(
      (s, a) =>
        s + ((a.account.data.parsed as { info?: { tokenAmount?: { uiAmount?: number } } })
          ?.info?.tokenAmount?.uiAmount ?? 0),
      0
    );
    devHoldsPercent = (devAmt / supplyUi) * 100;
  }

  const status = classify(curve, dex);

  return {
    mint,
    symbol: dexSymbol(mint),
    launchedAt,
    status,
    curveComplete: curve?.complete ?? null,
    curveDrained: curve
      ? curve.exists && !curve.complete && curve.realTokenReserves === 0
      : null,
    devHoldsPercent,
    top10Percent,
    liquidityUsd: dex?.liquidityUsd ?? null,
    volume24hUsd: dex?.volume24hUsd ?? null,
    priceChange24h: dex?.priceChange24h ?? null,
    dexUrl: dex?.url ?? null,
    devSold,
    authorityHygiene,
  };
}

function dexSymbol(_mint: string): string | null {
  // symbol is filled by the UI from DexScreener link / mint; keep null for now
  return null;
}

/** Determine the token lifecycle status from curve + DexScreener facts. */
function classify(
  curve: CurveState | null,
  dex: { liquidityUsd: number | null; priceChange24h: number | null } | null
): TokenStatus {
  const curveRugged =
    curve !== null && curve.exists && !curve.complete && curve.realTokenReserves === 0;
  if (curveRugged) return "RUGGED";
  if (curve && !curve.exists) return "DEAD"; // curve closed & never migrated data

  const liq = dex?.liquidityUsd ?? null;
  if (curve?.complete) {
    if (liq !== null && liq < 500) return "DEAD";
    return "GRADUATED";
  }
  if (liq !== null && liq > 0 && liq < 500) return "DEAD";
  if ((dex?.priceChange24h ?? 0) <= -90) return "CRASHED";
  if (curve && curve.exists && curve.realTokenReserves > 0) return "LIVE";
  if (liq === null && !curve) return "DEAD";
  return "LIVE";
}

