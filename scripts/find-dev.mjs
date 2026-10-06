// Find a recent pump.fun token creator to test BigBrother against.
// Usage: node scripts/find-dev.mjs
import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import bs58 from "bs58";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const conn = new Connection(RPC, "confirmed");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, n = 5) {
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      console.error(`retry ${i + 1}: ${String(e).slice(0, 100)}`);
      await sleep(1500);
    }
  }
  throw new Error("gave up");
}

const CREATE_DISC = createHash("sha256").update("global:create").digest().subarray(0, 8);

const sigs = await retry(() => conn.getSignaturesForAddress(PUMP, { limit: 150 }));
console.log(`got ${sigs.length} sigs`);

for (const s of sigs.slice(0, 150)) {
  if (s.err) continue;
  await sleep(400);
  let tx = null;
  try {
    tx = await conn.getParsedTransaction(s.signature, {
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    try {
      tx = await conn.getParsedTransaction(s.signature, {
        maxSupportedTransactionVersion: 1,
      });
    } catch {
      continue;
    }
  }
  if (!tx) continue;
  for (const ix of tx.transaction.message.instructions) {
    if ("programId" in ix && ix.programId.equals(PUMP) && typeof ix.data === "string") {
      const buf = bs58.decode(ix.data);
      if (buf.subarray(0, 8).equals(CREATE_DISC)) {
        const payer = tx.transaction.message.accountKeys[0].pubkey.toBase58();
        console.log(`CREATE TX found\n  dev/payer: ${payer}\n  sig: ${s.signature}`);
        process.exit(0);
      }
    }
  }
}
console.log("no create tx found in window");
