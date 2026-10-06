import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Rate-limited Solana RPC client for the free public endpoint.
 * Public RPC allows ~10 req/s bursts but quickly 429s; we serialize
 * requests with a minimum interval and retry with backoff on failure.
 */

export const PUBLIC_RPC =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

export const RPC_WS_URL =
  process.env.SOLANA_WS_URL ??
  PUBLIC_RPC.replace(/^http/, "ws").replace(/\/$/, "") + "/";

const MIN_INTERVAL_MS = 320; // ~3 req/s sustained, well within limits
const MAX_RETRIES = 2;
const CALL_TIMEOUT_MS = 20_000; // never let a hung connection stall the queue

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => undefined);
  return run as Promise<T>;
}

async function withRetry<T>(fn: () => Promise<T>, what: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await throttle(fn);
    } catch (err) {
      lastErr = err;
      const backoff = 500 * 2 ** attempt;
      console.warn(
        `[rpc] ${what} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying in ${backoff}ms`
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw new Error(`RPC call "${what}" failed after ${MAX_RETRIES + 1} attempts: ${String(lastErr)}`);
}

/**
 * Connection with a self-aborting fetch. CRITICAL: the old design raced a
 * Promise.race timeout against the request without aborting it, so one hung
 * HTTP socket stayed in the throttle chain forever and wedged every
 * subsequent RPC call (all timeouts, no recovery). Aborting inside the
 * request itself releases the socket and unwedges the chain automatically.
 */
export const connection = new Connection(PUBLIC_RPC, {
  commitment: "confirmed",
  fetch: async (url, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      throw new Error(
        `timeout: RPC request aborted after ${CALL_TIMEOUT_MS}ms (${String(err).slice(0, 80)})`
      );
    } finally {
      clearTimeout(timer);
    }
  },
});

export const rpc = {
  getBalance(pubkey: PublicKey) {
    return withRetry(() => connection.getBalance(pubkey), "getBalance");
  },
  getSignaturesForAddress(
    pubkey: PublicKey,
    opts: { limit?: number; before?: string }
  ) {
    return withRetry(
      () =>
        connection.getSignaturesForAddress(pubkey, {
          limit: opts.limit ?? 100,
          before: opts.before,
        }),
      "getSignaturesForAddress"
    );
  },
  getParsedTransaction(sig: string) {
    return withRetry(async () => {
      try {
        return await throttle(() =>
          connection.getParsedTransaction(sig, {
            maxSupportedTransactionVersion: 0,
          })
        );
      } catch (err) {
        // Some RPC nodes emit transactions above v0; retry with a higher cap.
        if (String(err).includes("version")) {
          return await throttle(() =>
            connection.getParsedTransaction(sig, {
              maxSupportedTransactionVersion: 1,
            })
          );
        }
        throw err;
      }
    }, "getParsedTransaction");
  },
  getParsedAccountInfo(pubkey: PublicKey) {
    return withRetry(
      () => connection.getParsedAccountInfo(pubkey),
      "getParsedAccountInfo"
    );
  },
  getAccountInfo(pubkey: PublicKey) {
    return withRetry(() => connection.getAccountInfo(pubkey), "getAccountInfo");
  },
  getTokenSupply(mint: PublicKey) {
    return withRetry(
      () => connection.getTokenSupply(mint),
      "getTokenSupply"
    );
  },
  getTokenLargestAccounts(mint: PublicKey) {
    return withRetry(
      () => connection.getTokenLargestAccounts(mint),
      "getTokenLargestAccounts"
    );
  },
  getTokenAccountsByOwner(owner: PublicKey, mint: PublicKey) {
    return withRetry(
      () =>
        connection.getParsedTokenAccountsByOwner(owner, {
          mint,
        }),
      "getTokenAccountsByOwner"
    );
  },
};

export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

export function isValidAddress(addr: string): boolean {
  try {
    new PublicKey(addr);
    return true;
  } catch {
    return false;
  }
}

/** Derive the pump.fun bonding curve PDA for a mint. */
export const PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

export async function bondingCurveAddress(
  mint: PublicKey
): Promise<PublicKey> {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding-curve"), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}
