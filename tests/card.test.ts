import { describe, expect, it } from "vitest";
import { cardText, extractAddresses, type CoinCard } from "../src/lib/card";

const MINT = "W7LjdSHiGM6nE376hFUHpGMVGLuj1nokhy8v2r5pump";
const SOL = "So11111111111111111111111111111111111111112";

describe("extractAddresses", () => {
  it("finds the address in a command, a link or a sentence", () => {
    expect(extractAddresses(`rep ${MINT}`)).toEqual([MINT]);
    expect(extractAddresses(`@someone rep https://pump.fun/coin/${MINT}`)).toEqual([MINT]);
    expect(extractAddresses(`https://solscan.io/token/${MINT}?cluster=mainnet`)).toEqual([MINT]);
    expect(extractAddresses(`check ${MINT} out, paired with ${SOL} and ${MINT}`)).toEqual([MINT, SOL]);
  });
  it("ignores text with no valid address", () => {
    expect(extractAddresses("rep")).toEqual([]);
    expect(extractAddresses("https://pump.fun/coin/notanaddress")).toEqual([]);
    // right length and alphabet, but not a valid 32-byte key
    expect(extractAddresses("z".repeat(44))).toEqual([]);
  });
});

describe("cardText", () => {
  const card: CoinCard = {
    mint: MINT, name: "Example", symbol: "EX", icon: null, launchpad: "pump.fun",
    mcap: 12_345, fees: 3.2, holders: 120, top10: 22.5, migrated: true,
    dev: "2hN82SJDtQ1kMuqAzJcFn2HjG9QmEpsxqk1Zh3pagqk", devLaunches: 22, devMigrations: 3,
    tier: "crazy", score: 76, best: { mint: SOL, symbol: "BEST", ath: 26_100 },
  };
  it("is a short plain-text summary", () => {
    expect(cardText(card)).toBe(
      "$EX (Example) · mcap $12.3K · migrated\nDev 2hN82…pagqk: CRAZY DEV, score 76\n22 launches, 3 migrated\nBest coin: $BEST ($26.1K ATH)"
    );
  });
  it("says so when the dev isn't rated", () => {
    expect(cardText({ ...card, tier: null, score: null, best: null })).toContain("not rated yet");
  });
});
