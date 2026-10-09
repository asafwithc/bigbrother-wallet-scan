import { describe, expect, it } from "vitest";
import { buildChart, type Exact, type JupStats, type Saved } from "../src/lib/launchStats";

type Pad = "pumpfun" | "stonk";
const NOW = Date.parse("2026-10-09T18:00:00Z");
const DAY = 86_400_000;
const win = (mints: number, graduates: number) => ({ mints, graduates });
const jup: JupStats = {
  pump: { d1: win(45_000, 1_200), d7: win(315_000, 9_000), d30: win(1_005_000, 32_000) },
  stonk: { d1: win(800, 20), d7: win(14_000, 290), d30: win(60_000, 1_210) },
  at: NOW,
};
const row = (mints: number, graduates: number, iso: string): Saved => ({
  mints,
  graduates,
  updated_at: Date.parse(iso) / 1000,
});
const noSaved = new Map<string, Partial<Record<Pad, Saved>>>();
const noHistory = new Map<string, Partial<Record<Pad, Exact>>>();
const day = (c: ReturnType<typeof buildChart>, date: string) => c.days.find((d) => d.date === date)!;
/** exact rows for every day from..to (inclusive), values from fn(dayIndex) */
function fill(
  h: Map<string, Partial<Record<Pad, Exact>>>,
  pad: Pad,
  from: string,
  to: string,
  fn: (n: number) => Exact
) {
  let n = 0;
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY, n++) {
    const date = new Date(t).toISOString().slice(0, 10);
    h.set(date, { ...h.get(date), [pad]: fn(n) });
  }
}

describe("launch chart", () => {
  it("with Jupiter only: 30 days, today's real 24h count, then real period averages", () => {
    const c = buildChart(jup, noSaved, noHistory, NOW);
    expect(c.days).toHaveLength(30);
    expect(c.days[29]).toMatchObject({ date: "2026-10-09", pump: 45_000, stonk: 800, pumpMigrated: 1_200, pumpSource: "live", notes: ["last 24 hours"] });
    // days 2-7 share what's left of the 7-day total, days 8-30 what's left of the 30-day total
    expect(c.days[28]).toMatchObject({ pump: 45_000, stonk: 2_200, pumpMigrated: 1_300, pumpSource: "average", notes: ["daily average, Oct 3 – Oct 8"] });
    expect(c.days[22]).toMatchObject({ pump: 30_000, stonk: 2_000, pumpMigrated: 1_000, notes: ["daily average, Sep 10 – Oct 2"] });
    expect(c.days.slice(23).reduce((s, d) => s + d.pump, 0)).toBe(jup.pump.d7.mints);
    expect(c.days.reduce((s, d) => s + d.pump, 0)).toBe(jup.pump.d30.mints);
  });

  it("uses a saved count for a past day and says when it was taken", () => {
    const saved = new Map<string, Partial<Record<Pad, Saved>>>([
      ["2026-10-07", { pumpfun: row(50_000, 1_400, "2026-10-07T23:55:00Z"), stonk: row(900, 30, "2026-10-07T23:55:00Z") }],
      ["2026-10-05", { pumpfun: row(40_000, 1_000, "2026-10-05T15:02:00Z") }],
    ]);
    const c = buildChart(jup, saved, noHistory, NOW);
    expect(day(c, "2026-10-07")).toMatchObject({ pump: 50_000, stonk: 900, pumpMigrated: 1_400, pumpSource: "saved", notes: [] });
    expect(day(c, "2026-10-05")).toMatchObject({ pump: 40_000, pumpSource: "saved", stonkSource: "average" });
    expect(day(c, "2026-10-05").notes).toContain("pump.fun: 24 hours to 15:02 UTC");
    // the other four days of the week share what's left: (315k - 45k - 50k - 40k) / 4
    expect(day(c, "2026-10-06")).toMatchObject({ pump: 45_000, pumpSource: "average" });
  });

  it("exact Dune days give every day its own number, with migrations", () => {
    const history = new Map<string, Partial<Record<Pad, Exact>>>();
    // pump.fun: exact through yesterday; StonkFun: exact only to Sep 22
    fill(history, "pumpfun", "2026-07-12", "2026-10-08", (n) => ({ mints: 30_000 + n * 100, graduates: 1_000 + n }));
    fill(history, "stonk", "2026-08-28", "2026-09-22", (n) => ({ mints: 1_000 + n, graduates: null }));
    const c = buildChart(jup, noSaved, history, NOW);
    expect(c.days).toHaveLength(90);
    expect(c.days[0]).toMatchObject({ date: "2026-07-12", pump: 30_000, pumpMigrated: 1_000, pumpSource: "exact" });

    // the last two weeks are no longer flat for pump.fun
    const lastTwoWeeks = c.days.slice(-15, -1).map((d) => d.pump);
    expect(new Set(lastTwoWeeks).size).toBe(14);
    expect(day(c, "2026-10-08")).toMatchObject({ pump: 38_800, pumpMigrated: 1_088, pumpSource: "exact" });

    // before StonkFun's first row it simply counts as 0, with no note
    expect(day(c, "2026-08-01")).toMatchObject({ stonk: 0, stonkSource: "none", notes: [] });
    // After its dataset ends, StonkFun's known days (Sep 10-22, 13 days summing
    // to 13,247) come out of Jupiter's period total and the rest is shared by
    // the 10 unknown days: (60,000 - 14,000 - 13,247) / 10
    expect(day(c, "2026-09-25")).toMatchObject({
      stonk: 3_275,
      stonkSource: "average",
      pumpSource: "exact",
      notes: ["StonkFun: daily average, Sep 23 – Oct 2"],
    });
    expect(day(c, "2026-10-05")).toMatchObject({ stonk: 2_200, notes: ["StonkFun: daily average, Oct 3 – Oct 8"] });

    // "this week" is the 7 full days before today, as charted
    expect(c.week).toEqual({ pump: 38_500, stonk: Math.round((2_200 * 6 + 3_275) / 7) });
  });

  it("splits a period's unknown days by each day's real trading volume", () => {
    // Oct 3-8 volumes 1:2:3:4:5:5 (sum 20) share the week's 13,200 StonkFun launches
    const stonkVol: Record<string, number> = {
      "2026-10-03": 1e6, "2026-10-04": 2e6, "2026-10-05": 3e6,
      "2026-10-06": 4e6, "2026-10-07": 5e6, "2026-10-08": 5e6,
    };
    const c = buildChart({ ...jup, stonkVol }, noSaved, noHistory, NOW);
    const week = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) => day(c, d));
    expect(week.map((d) => d.stonk)).toEqual([660, 1_320, 1_980, 2_640, 3_300, 3_300]);
    expect(week.reduce((t, d) => t + d.stonk, 0)).toBe(jup.stonk.d7.mints - jup.stonk.d1.mints);
    expect(week[0]).toMatchObject({ stonkSource: "estimate", pumpSource: "average" });
    expect(week[0].notes).toContain("StonkFun: estimated from that day's trading volume");
    // no volume for the earlier period, so it stays an even daily average
    expect(day(c, "2026-09-20")).toMatchObject({ stonk: 2_000, stonkSource: "average" });
  });

  it("marks days with no source at all", () => {
    const history = new Map<string, Partial<Record<Pad, Exact>>>([
      ["2026-08-20", { pumpfun: { mints: 52_000, graduates: 1_410 } }],
    ]);
    const c = buildChart(jup, noSaved, history, NOW);
    expect(c.days[0]).toMatchObject({ date: "2026-08-20", pump: 52_000, pumpMigrated: 1_410, pumpSource: "exact" });
    expect(c.days[1]).toMatchObject({ pump: 0, pumpSource: "none", pumpMigrated: null, notes: ["no data for this day"] });
  });

  it("returns nothing when there is no source and no history", () => {
    expect(buildChart(null, noSaved, noHistory, NOW)).toEqual({ days: [], week: null, source: null });
  });
});
