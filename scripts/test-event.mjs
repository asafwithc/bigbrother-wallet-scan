// Verify the pump.fun CreateEvent discriminator against live websocket data.
import { Connection, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import bs58 from "bs58";

const c = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const pump = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const disc = createHash("sha256").update("event:CreateEvent").digest().subarray(0, 8);

c.onLogs(
  pump,
  ({ logs, err }) => {
    if (err) return;
    for (const line of logs) {
      if (!line.startsWith("Program data: ")) continue;
      const buf = Buffer.from(line.slice(14), "base64");
      if (buf.length >= 8 && buf.subarray(0, 8).equals(disc)) {
        let off = 8;
        const rs = () => {
          const len = buf.readUInt32LE(off);
          off += 4;
          const s = buf.subarray(off, off + len).toString("utf8");
          off += len;
          return s;
        };
        const name = rs();
        const symbol = rs();
        const uri = rs();
        const mint = bs58.encode(buf.subarray(off, off + 32));
        off += 32;
        const curve = bs58.encode(buf.subarray(off, off + 32));
        off += 32;
        const dev = bs58.encode(buf.subarray(off, off + 32));
        console.log(
          "EVENT OK:",
          JSON.stringify({ name, symbol, mint, dev: dev.slice(0, 10), curve: curve.slice(0, 10), uri: uri.slice(0, 40) })
        );
        process.exit(0);
      }
    }
  },
  "confirmed"
);

setTimeout(() => {
  console.log("no CreateEvent in 90s");
  process.exit(0);
}, 90_000);
