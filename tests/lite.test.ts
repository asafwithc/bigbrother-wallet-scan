import { describe, expect, it } from "vitest";
import { decide, type LiteFacts } from "../src/lib/analysis/lite";
import { tierOf } from "../src/lib/tiers";

const dead = { graduated: false, dead: true, mcap: 0 };
const grad = { graduated: true, dead: false, mcap: 40_000 };
const big = { graduated: true, dead: false, mcap: 2_000_000 };
const facts = (f: Partial<LiteFacts>): LiteFacts => ({
  prior: [],
  launchesPerDay: 1,
  totalCoins: 1,
  maxPerHour: 1,
  txCount: null,
  activeSpanDays: null,
  ...f,
});
const tier = (f: Partial<LiteFacts>) => {
  const r = decide(facts(f));
  return tierOf(r.verdict, r.score);
};

describe("lite dev check", () => {
  it("a dev with a single launch is unknown, whatever the wallet looks like", () => {
    expect(tier({ totalCoins: 1 })).toBe("unknown");
    expect(tier({ totalCoins: 1, txCount: 100, activeSpanDays: 0.5 })).toBe("unknown");
  });
  it("a dev with 2+ launches is never unknown", () => {
    expect(tier({ totalCoins: 2, prior: [dead] })).toBe("farmer");
    expect(tier({ totalCoins: 2, prior: [{ graduated: false, dead: false, mcap: 4000 }] })).toBe("farmer");
    expect(tier({ totalCoins: 2, prior: [grad] })).toBe("crazy");
  });
  it("graduated coins move a dev up the tiers", () => {
    expect(tier({ totalCoins: 3, prior: [grad, dead] })).toBe("crazy");
    expect(tier({ totalCoins: 4, prior: [big, grad, grad] })).toBe("crazy");
  });
  it("a coin with traction counts for the dev", () => {
    expect(tier({ totalCoins: 2, prior: [{ graduated: false, dead: false, mcap: 30_000 }] })).toBe("crazy");
    expect(tier({ totalCoins: 3, prior: [{ graduated: false, dead: false, mcap: 12_000 }, dead] })).toBe("proven");
    expect(tier({ totalCoins: 5, prior: [{ graduated: false, dead: false, mcap: 12_000 }, dead, dead, dead] })).toBe("good");
  });
  it("dead launches drag a dev down", () => {
    const clean = decide(facts({ totalCoins: 3, prior: [grad, grad] })).score;
    const mixed = decide(facts({ totalCoins: 5, prior: [grad, grad, dead, dead] })).score;
    expect(mixed).toBeGreaterThan(clean); // higher = riskier
  });
  it("mass launchers get the worst grade", () => {
    expect(decide(facts({ totalCoins: 22, maxPerHour: 22 })).verdict).toBe("Likely Rugged");
    expect(decide(facts({ totalCoins: 9, prior: Array(8).fill(dead) })).verdict).toBe("Likely Rugged");
  });
  it("credits migrations from the wallet's all-time record", () => {
    expect(tier({ totalCoins: 2, prior: [dead], allTimeMints: 10, allTimeMigrations: 2 })).not.toBe("farmer");
    // a rounding error on a mass launcher's record does not count
    expect(tier({ totalCoins: 2, prior: [dead], allTimeMints: 5000, allTimeMigrations: 20 })).toBe("farmer");
  });
  it("a win with a rough record is still a good dev", () => {
    expect(tier({ totalCoins: 6, prior: [{ graduated: false, dead: false, mcap: 8_000 }, dead, dead, dead, dead], maxPerHour: 3 })).toBe("good");
  });
});
