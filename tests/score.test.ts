import { describe, expect, it } from "vitest";
import {
  scoreWallet,
  verdictFor,
  type ScoringInput,
  type TokenFacts,
} from "../src/lib/analysis/score";

function token(over: Partial<TokenFacts> = {}): TokenFacts {
  return {
    status: "LIVE",
    authorityHygiene: 1,
    devHoldsPercent: 2,
    top10Percent: 20,
    devSold: false,
    liquidityUsd: 50_000,
    curveComplete: true,
    ...over,
  };
}

const healthyInput: ScoringInput = {
  tokens: [token()],
  walletAgeDays: 200,
  launchSpanDays: 30,
};

const ruggerInput: ScoringInput = {
  tokens: [
    token({ status: "RUGGED", authorityHygiene: 0, devSold: true, top10Percent: 85, liquidityUsd: 0, curveComplete: false }),
    token({ status: "RUGGED", authorityHygiene: 0.5, devHoldsPercent: 0, top10Percent: 90, liquidityUsd: 12, curveComplete: false }),
    token({ status: "CRASHED", authorityHygiene: 0, devSold: true, top10Percent: 70, liquidityUsd: 300, curveComplete: false }),
  ],
  walletAgeDays: 0.4,
  launchSpanDays: 3,
};

describe("verdictFor", () => {
  it("maps score bands to verdicts", () => {
    expect(verdictFor(0)).toBe("Legit");
    expect(verdictFor(29.9)).toBe("Legit");
    expect(verdictFor(30)).toBe("Suspicious");
    expect(verdictFor(59.9)).toBe("Suspicious");
    expect(verdictFor(60)).toBe("Likely Rugged");
    expect(verdictFor(100)).toBe("Likely Rugged");
  });
});

describe("scoreWallet", () => {
  it("scores a healthy dev as Legit", () => {
    const { score, verdict } = scoreWallet(healthyInput);
    expect(verdict).toBe("Legit");
    expect(score).toBeLessThan(30);
  });

  it("scores a serial rugger as Likely Rugged", () => {
    const { score, verdict } = scoreWallet(ruggerInput);
    expect(verdict).toBe("Likely Rugged");
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("is monotonic: more rug evidence never lowers the score", () => {
    const low = scoreWallet({
      tokens: [token({ status: "DEAD" })],
      walletAgeDays: 30,
      launchSpanDays: 10,
    });
    const high = scoreWallet({
      tokens: [
        token({ status: "DEAD" }),
        token({ status: "RUGGED", devSold: true }),
      ],
      walletAgeDays: 0.5,
      launchSpanDays: 2,
    });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("handles empty token lists gracefully", () => {
    const { score, signals } = scoreWallet({
      tokens: [],
      walletAgeDays: null,
      launchSpanDays: null,
    });
    expect(score).toBe(0);
    expect(signals).toHaveLength(7);
    expect(signals.every((s) => s.points >= 0 && s.points <= s.max)).toBe(true);
  });

  it("caps every signal at its max and total at 100", () => {
    const worst: ScoringInput = {
      tokens: Array.from({ length: 8 }, () =>
        token({
          status: "RUGGED",
          authorityHygiene: 0,
          devHoldsPercent: 0,
          devSold: true,
          top10Percent: 95,
          liquidityUsd: 0,
          curveComplete: false,
        })
      ),
      walletAgeDays: 0.1,
      launchSpanDays: 1,
    };
    const { score, signals } = scoreWallet(worst);
    for (const s of signals) {
      expect(s.points).toBeLessThanOrEqual(s.max + 1e-9);
    }
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(90); // worst case should be near max
  });

  it("wallet age signal is graded, not binary", () => {
    const fresh = scoreWallet({ ...healthyInput, walletAgeDays: 0.5 });
    const weekOld = scoreWallet({ ...healthyInput, walletAgeDays: 6 });
    const old = scoreWallet({ ...healthyInput, walletAgeDays: 365 });
    expect(fresh.score).toBeGreaterThan(weekOld.score);
    expect(weekOld.score).toBeGreaterThan(old.score);
  });
});
