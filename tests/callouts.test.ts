import { beforeAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

type Db = ReturnType<typeof import("../src/lib/db").getDb>;
let db: Db;
let ensureCalloutPicks: typeof import("../src/lib/callouts").ensureCalloutPicks;

let SLOT = 0; // slot length in seconds, read from the module under test
const N = 1_000_000; // the "current" slot
const now = () => N * SLOT + 10;

function launch(mint: string, slot: number, offset = 5) {
  db.prepare(
    "INSERT INTO launches (signature, mint, launchpad, name, symbol, dev, block_time) VALUES (?, ?, 'pumpfun', ?, ?, 'dev', ?)"
  ).run(`sig-${mint}-${slot}-${offset}`, mint, mint, mint, slot * SLOT + offset);
}
const picks = () =>
  db.prepare("SELECT slot, mint FROM callouts ORDER BY slot").all() as { slot: number; mint: string }[];

beforeAll(async () => {
  // db.ts opens ./bigbrother.db, so run against an empty one in a temp folder
  process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "bb-callouts-")));
  db = (await import("../src/lib/db")).getDb();
  (await import("../src/lib/market")).ensureCoinsTable();
  const lib = await import("../src/lib/callouts");
  ensureCalloutPicks = lib.ensureCalloutPicks;
  SLOT = lib.SLOT_S;

  launch("a1", N - 3);
  launch("a2", N - 3, 20);
  launch("b1", N - 2);
  launch("now1", N); // current slot isn't finished yet
  // slot N-1 only has coins that must never be picked:
  launch("old", N - 10);
  launch("old", N - 1); // seen before this slot
  launch("mig", N - 1);
  db.prepare("INSERT INTO coins (mint, migrated) VALUES ('mig', 1)").run();
});

describe("callout picks", () => {
  it("picks one coin per finished slot, from that slot", () => {
    ensureCalloutPicks(now());
    const p = picks();
    const bySlot = new Map(p.map((r) => [r.slot, r.mint]));
    expect(["a1", "a2"]).toContain(bySlot.get(N - 3));
    expect(bySlot.get(N - 2)).toBe("b1");
    expect(bySlot.get(N - 10)).toBe("old");
    expect(bySlot.has(N)).toBe(false);
  });

  it("skips migrated coins and coins first seen in an earlier slot", () => {
    expect(picks().some((r) => r.slot === N - 1)).toBe(false);
  });

  it("keeps the same picks on later calls", () => {
    const before = picks();
    expect(ensureCalloutPicks(now())).toBe(0);
    expect(picks()).toEqual(before);
  });
});
