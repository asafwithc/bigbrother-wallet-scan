/**
 * Launchpad registry — BigBrother monitors bonding-curve launchpads for
 * new token launches and tracks the dev wallet behind each one.
 *
 * pump.fun is live by default (verified program id).
 * Other launchpads (stonk, …) become active the moment their on-chain
 * program id is provided via env vars — the detection pipeline is generic:
 *   1. subscribe to program logs (or poll signatures as fallback)
 *   2. on a create-looking transaction, fetch it and extract
 *      the initialized mint + the fee payer (= the dev)
 */

export interface LaunchpadConfig {
  id: string;
  name: string;
  color: string;
  /** on-chain program address; null = not configured yet */
  programId: string | null;
  /** regex matched against program log lines to shortlist create txs */
  createLogPattern: RegExp;
  /** launchpad frontend URL template (%s = mint) */
  explorerUrl?: string;
}

export const LAUNCHPADS: LaunchpadConfig[] = [
  {
    id: "pumpfun",
    name: "pump.fun",
    color: "text-green-300 border-green-500/40 bg-green-500/10",
    programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    createLogPattern: /Instruction: Create/i,
    explorerUrl: "https://pump.fun/coin/%s",
  },
  {
    id: "stonk",
    name: "stonk",
    color: "text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10",
    // StonkFun (stonksx.fun) has not published its program yet.
    // Set STONK_PROGRAM_ID once known and the monitor picks it up on restart.
    programId: process.env.STONK_PROGRAM_ID ?? null,
    createLogPattern: /Instruction: Create/i,
    explorerUrl: "https://stonksx.fun/token/%s",
  },
];
