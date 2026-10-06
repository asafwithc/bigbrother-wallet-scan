// Standalone probe: WS subscription health + latest launches from DB.
// Usage: node scripts/probe-ws.mjs [wsUrl]
import WebSocket from "ws";
import { execSync } from "node:child_process";

const wsUrl = process.argv[2] ?? "wss://api.mainnet-beta.solana.com/";
const PUMP = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

// DB check via the app's own db module (uses better-sqlite3)
try {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database("data/bigbrother.db", { readonly: true });
  const rows = db
    .prepare(
      "SELECT symbol, blockTime, dev_score, dev_verdict FROM launches ORDER BY blockTime DESC LIMIT 5"
    )
    .all();
  console.log("--- latest launches ---");
  for (const r of rows) {
    console.log(
      new Date((r.blockTime ?? 0) * 1000).toISOString(),
      r.symbol ?? "?",
      "score:",
      r.dev_score ?? "-"
    );
  }
  console.log(
    "total:",
    db.prepare("SELECT COUNT(*) c FROM launches").get().c,
    "| scored:",
    db.prepare("SELECT COUNT(*) c FROM launches WHERE dev_score IS NOT NULL").get().c
  );
  db.close();
} catch (e) {
  console.log("db probe failed:", String(e).slice(0, 120));
}

console.log("--- ws probe:", wsUrl);
const ws = new WebSocket(wsUrl);
let n = 0;
const t0 = Date.now();
ws.on("open", () => {
  console.log("ws open");
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [
        { mentions: [PUMP] },
        { commitment: "confirmed" },
      ],
    })
  );
});
ws.on("message", (d) => {
  n++;
  if (n <= 2 || n % 200 === 0) {
    const s = d.toString().slice(0, 120);
    console.log(`msg ${n} (${Math.round((Date.now() - t0) / 1000)}s): ${s}`);
  }
});
ws.on("error", (e) => console.log("WS ERR:", String(e).slice(0, 140)));
ws.on("close", (c) => console.log("WS CLOSE:", c));
setTimeout(() => {
  console.log(`total messages in 45s: ${n}`);
  process.exit(0);
}, 45_000);
