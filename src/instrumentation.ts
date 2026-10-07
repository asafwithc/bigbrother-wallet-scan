/**
 * Next.js instrumentation hook — runs once when the server boots.
 * Starts the on-chain launch monitor (websocket + poller) in the
 * Node.js runtime, skipping during production build.
 */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startMonitor } = await import("./lib/monitor");
    startMonitor();
    const { startBackfill } = await import("./lib/backfill");
    startBackfill();
    const { startHistoryBackfill } = await import("./lib/historyBackfill");
    startHistoryBackfill();
  }
}
