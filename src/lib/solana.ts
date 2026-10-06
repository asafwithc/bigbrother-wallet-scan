import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

/**
 * Rate-limited Solana RPC client for the free public endpoint.
 * Public RPC allows ~10 req/s bursts but quickly 429s; we serialize
 * requests with a minimum interval and retry with backoff on failure.
 */

const PUBLIC_RPC =
  process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

const MIN_INTERVAL_MS = 320; // ~3 req/s sustained, well within limits
const MAX_RETRIES = 4;
const CALL_TIMEOUT_MS = 20_000; // never let a hung connection stall the queue

let chain: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`timeout: RPC "${what}" did not respond in ${CALL_TIMEOUT_MS}ms`)),
        CALL_TIMEOUT_MS
      )
    ),
  ]);
}

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
      return await withTimeout(throttle(fn), what);
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

export const connection = new Connection(PUBLIC_RPC, {
  commitment: "confirmed",
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
