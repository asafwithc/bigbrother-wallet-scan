import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { rpc, PUMP_PROGRAM_ID } from "../solana";

/**
 * On-chain pump.fun integration.
 *
 * We never rely on the unofficial frontend API (Cloudflare-blocked for
 * scripts). Instead we parse the wallet's real transactions on-chain:
 *  - `create` instruction  => dev launched a token
 *  - `sell` instruction    => dev sold their own bag
 *
 * Anchor discriminators = first 8 bytes of sha256("global:<name>").
 */

export const PUMP_PROGRAM = PUMP_PROGRAM_ID;

function discriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

const CREATE_DISC = discriminator("create");
const SELL_DISC = discriminator("sell");

export interface PumpCreateTx {
  signature: string;
  blockTime: number | null;
  mint: string | null; // mint created in this tx, when detected
}

function asDecoded(ix: unknown): PartiallyDecodedInstruction | null {
  if (
    ix &&
    typeof ix === "object" &&
    "programId" in (ix as Record<string, unknown>) &&
    "data" in (ix as Record<string, unknown>)
  ) {
    return ix as PartiallyDecodedInstruction;
  }
  return null;
}

function programIxs(
  tx: ParsedTransactionWithMeta
): PartiallyDecodedInstruction[] {
  const outer = (tx.transaction.message.instructions ?? [])
    .map(asDecoded)
    .filter((x): x is PartiallyDecodedInstruction => !!x);
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((i) =>
    (i.instructions ?? [])
      .map(asDecoded)
      .filter((x): x is PartiallyDecodedInstruction => !!x)
  );
  return [...outer, ...inner];
}

function dataStartsWithBase58(dataB58: string, prefix: Buffer): boolean {
  try {
    const buf = Buffer.from(bs58Decode(dataB58));
    return buf.subarray(0, 8).equals(prefix);
  } catch {
    return false;
  }
}

// Minimal base58 decode (avoid pulling bs58 dependency)
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of str) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) throw new Error("invalid base58");
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // leading zeros
  for (const ch of str) {
    if (ch === "1") bytes.push(0);
    else break;
  }
  return new Uint8Array(bytes.reverse());
}

export interface DevTxScan {
  createdMints: { mint: string; signature: string; blockTime: number | null }[];
  soldMints: Set<string>;
  txsScanned: number;
}

/**
 * Scan a wallet's recent transactions for pump.fun `create` and `sell`
 * instructions. `maxTxs` caps RPC cost (each tx = 1 RPC call).
 */
export async function scanWalletPumpActivity(
  wallet: PublicKey,
  maxTxs = 30
): Promise<DevTxScan> {
  const sigs = await rpc.getSignaturesForAddress(wallet, { limit: 50 }); // reduced from 150 to 50
  const result: DevTxScan = {
    createdMints: [],
    soldMints: new Set(),
    txsScanned: 0,
  };

  for (const sig of sigs) {
    if (result.txsScanned >= maxTxs) break;
    if (sig.err) continue; // failed txs can't have created anything
    let tx: ParsedTransactionWithMeta | null;
    try {
      tx = await rpc.getParsedTransaction(sig.signature);
    } catch {
      continue;
    }
    if (!tx) continue;
    result.txsScanned++;

    const ixs = programIxs(tx).filter(
      (ix) => ix.programId.equals(PUMP_PROGRAM) && typeof ix.data === "string"
    );

    // detect create: the create tx initializes a mint; the pump create
    // instruction's data starts with the create discriminator
    for (const ix of ixs) {
      if (dataStartsWithBase58(ix.data, CREATE_DISC)) {
        // find the mint initialized in this tx via parsed spl-token ix
        const mint = findMintInTx(tx);
        result.createdMints.push({
          mint: mint ?? "unknown",
          signature: sig.signature,
          blockTime: tx.blockTime ?? null,
        });
      }
      if (dataStartsWithBase58(ix.data, SELL_DISC)) {
        // sell: accounts[1] = mint (pump.fun sell: trader, mint, bonding_curve, ata, ...)
        const keys = ix.accounts;
        if (keys.length >= 3) {
          result.soldMints.add(keys[1].toBase58());
        }
      }
    }
  }

  return result;
}

export function findMintInTx(tx: ParsedTransactionWithMeta): string | null {
  const all = [
    ...(tx.transaction.message.instructions ?? []),
    ...(tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions ?? []),
  ];
  for (const ix of all) {
    const dec = asDecoded(ix);
    if (!dec) continue;
    // parsed initializeMint (spl-token / token-2022)
    const parsed = ix as { parsed?: { type?: string; info?: Record<string, unknown> } };
    if (
      parsed.parsed?.type &&
      ["initializeMint", "initializeMint2", "initializeMintCloseAuthority"].includes(
        parsed.parsed.type
      ) &&
      typeof parsed.parsed.info?.mint === "string"
    ) {
      return parsed.parsed.info.mint as string;
    }
    // fallback: raw initializeMint2 to token-2022 program
    if (
      dec.programId.toBase58() === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" &&
      typeof dec.data === "string"
    ) {
      const buf = Buffer.from(bs58Decode(dec.data));
      if (buf[0] === 0 || buf[0] === 18) {
        // InitializeMint / InitializeMint2: byte0, decimals, mint(32), ...
        if (buf.length >= 33) {
          return new PublicKey(buf.subarray(1, 33)).toBase58();
        }
      }
    }
  }
  return null;
}

export interface PumpCreateArgs {
  name: string;
  symbol: string;
  uri: string;
  creator: string | null;
}

/* ------------------------------------------------------------------ */
/* CreateEvent — anchor event emitted as "Program data: <base64>"      */
/* in the program logs. Decoding it from a websocket notification      */
/* gives us the full launch (mint + dev + metadata) with ZERO extra    */
/* RPC calls.                                                          */
/* ------------------------------------------------------------------ */

const CREATE_EVENT_DISC = createHash("sha256")
  .update("event:CreateEvent") // anchor event discriminator = sha256("event:<EventName>")
  .digest()
  .subarray(0, 8);

export interface PumpCreateEvent {
  name: string;
  symbol: string;
  uri: string;
  mint: string;
  bondingCurve: string;
  user: string; // the dev wallet
}

export function parseCreateEventData(b64: string): PumpCreateEvent | null {
  try {
    const buf = Buffer.from(b64, "base64");
    if (buf.length < 8 || !buf.subarray(0, 8).equals(CREATE_EVENT_DISC)) {
      return null;
    }
    let off = 8;
    const readStr = (): string => {
      const len = buf.readUInt32LE(off);
      off += 4;
      const s = buf.subarray(off, off + len).toString("utf8");
      off += len;
      return s;
    };
    const name = readStr();
    const symbol = readStr();
    const uri = readStr();
    const pk = (): string => {
      const p = new PublicKey(buf.subarray(off, off + 32)).toBase58();
      off += 32;
      return p;
    };
    const mint = pk();
    const bondingCurve = pk();
    const user = pk();
    return { name, symbol, uri, mint, bondingCurve, user };
  } catch {
    return null;
  }
}

/**
 * Parse pump.fun `create` instruction args.
 * Layout after the 8-byte discriminator:
 *   name: string, symbol: string, uri: string (4-byte LE length + utf8),
 *   creator: [u8; 32]
 */
export function parseCreateArgs(dataB58: string): PumpCreateArgs | null {
  try {
    const buf = Buffer.from(bs58Decode(dataB58));
    if (buf.length < 8 || !buf.subarray(0, 8).equals(CREATE_DISC)) return null;
    let off = 8;
    const readStr = (): string => {
      const len = buf.readUInt32LE(off);
      off += 4;
      const s = buf.subarray(off, off + len).toString("utf8");
      off += len;
      return s;
    };
    const name = readStr();
    const symbol = readStr();
    const uri = readStr();
    let creator: string | null = null;
    if (off + 32 <= buf.length) {
      creator = new PublicKey(buf.subarray(off, off + 32)).toBase58();
    }
    return { name, symbol, uri, creator };
  } catch {
    return null;
  }
}

export interface CurveState {
  complete: boolean;
  realTokenReserves: number; // raw (6 decimals)
  realSolReserves: number;
  virtualTokenReserves: number;
  virtualSolReserves: number;
  exists: boolean;
}

/**
 * Read pump.fun bonding curve account state.
 * Layout: 8-byte disc, virtual_token u64, virtual_sol u64, real_token u64,
 * real_sol u64, token_total_supply u64, complete: u8.
 */
export async function getCurveState(
  curve: PublicKey
): Promise<CurveState | null> {
  const info = await rpc.getAccountInfo(curve);
  if (!info) return { complete: false, realTokenReserves: 0, realSolReserves: 0, virtualTokenReserves: 0, virtualSolReserves: 0, exists: false };
  const d = info.data;
  if (d.length < 49) return null;
  const readU64 = (off: number): number => Number(d.readBigUInt64LE(off));
  return {
    exists: true,
    virtualTokenReserves: readU64(8),
    virtualSolReserves: readU64(16),
    realTokenReserves: readU64(24),
    realSolReserves: readU64(32),
    complete: d[48] === 1,
  };
}
