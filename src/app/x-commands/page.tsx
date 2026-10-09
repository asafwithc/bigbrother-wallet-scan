import { getDb } from "@/lib/db";
import { ensureCoinsTable } from "@/lib/market";
import { Decode, Eyebrow } from "@/components/decode";

// read .env on every request, so changing the handle needs no rebuild
export const dynamic = "force-dynamic";

/** A real coin from our own records to use in the examples. */
function exampleMint(): string {
  try {
    ensureCoinsTable();
    const row = getDb()
      .prepare(
        "SELECT mint FROM coins WHERE migrated = 1 AND mint LIKE '%pump' AND fees IS NOT NULL ORDER BY fees DESC LIMIT 1"
      )
      .get() as { mint: string } | undefined;
    if (row) return row.mint;
  } catch {
    /* fall through */
  }
  return "<contract address>";
}

export default function XCommands() {
  // X_HANDLE=yourhandle in .env (with or without the @)
  const handle = (process.env.X_HANDLE ?? "").trim().replace(/^@/, "");
  // X_BOT_LIVE=true once the bot is actually replying on X
  const live = process.env.X_BOT_LIVE === "true";
  const at = handle ? `@${handle}` : "@your_handle";
  const mint = exampleMint();

  const commands = [
    {
      args: "rep <contract address>",
      text: "Drop a contract address and get the coin's card back: who the dev is, their rank and score, how many coins they have launched and migrated, and their best one.",
      example: `${at} rep ${mint}`,
    },
    {
      args: "rep",
      text: "See a shill, a call or any post with a coin in it? Reply with just rep. The bot reads the coin from that post and answers right there in the thread.",
      example: `${at} rep (as a reply under any post that has a contract address or a coin link)`,
    },
    {
      args: "rep <pump.fun, Solscan or DEX Screener link>",
      text: "Any link with the coin's address in it works the same, and so does a DEX Screener pool link.",
      example: `${at} rep https://pump.fun/coin/${mint}`,
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-[280px] flex-1">
          <Eyebrow>x bot</Eyebrow>
          <h1 className="mb-3.5 mt-2 text-[40px] font-bold tracking-tight">
            <Decode text="X commands" />
          </h1>
          <p className="max-w-[660px] text-[17px] leading-normal text-zinc-400">
            Someone shilling a coin in your feed? Tag {at} under the post and get the dev&apos;s
            record back in the thread: who launched it, how they rank, and what their best coin
            did.
          </p>
        </div>
        <div className="mt-3.5 flex items-center gap-2.5 rounded-[12px] border border-edge bg-panel px-4 py-3 text-sm text-zinc-300">
          <i
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: handle && live ? "#34d399" : "#3d6151" }}
          />
          {!handle
            ? "X handle not set: add X_HANDLE to .env"
            : live
              ? `${at} is answering`
              : `${at} isn't answering yet`}
        </div>
      </div>

      <section className="mt-7 overflow-hidden rounded-[14px] border border-edge bg-panel">
        {commands.map((c, i) => (
          <div key={c.args} className={`px-6 py-6 ${i > 0 ? "border-t border-edge" : ""}`}>
            <div className="mono text-[17px]">
              <span className="text-matrix">{at}</span> {c.args}
            </div>
            <p className="mt-2.5 max-w-[920px] text-[15px] leading-relaxed text-zinc-300">{c.text}</p>
            <div className="mono mt-2 break-all text-[13px] text-zinc-500">e.g. {c.example}</div>
          </div>
        ))}
      </section>

      <footer className="mt-16 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-edge pt-7 text-[13px] text-zinc-500">
        <span>BigBrother ranks pump.fun devs from on-chain history. Not financial advice.</span>
        {handle && (
          <>
            <span>·</span>
            <a
              href={`https://x.com/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-200 hover:underline"
            >
              {at} on X
            </a>
          </>
        )}
      </footer>
    </div>
  );
}
