import { getDb } from "@/lib/db";
import { ensureCoinsTable } from "@/lib/market";
import { getLaunchTotals24h } from "@/lib/launchStats";
import { cached } from "@/lib/cache";
import { TIER_STYLE, tierSql, type Tier } from "@/lib/tiers";
import { TierIcon } from "@/components/tier-icon";
import { Decode } from "@/components/decode";

// live numbers are read on every request
export const dynamic = "force-dynamic";

const TIERS: Tier[] = ["crazy", "proven", "good", "unknown", "farmer"];
const NAME: Record<Tier, string> = {
  crazy: "Crazy dev",
  proven: "Proven dev",
  good: "Good dev",
  unknown: "Unknown dev",
  farmer: "Farmer",
};

const SECTIONS = [
  { id: "loop", label: "The loop" },
  { id: "live", label: "Live numbers" },
  { id: "colours", label: "Five ranks, five colours" },
  { id: "ranks", label: "The ranks" },
  { id: "score", label: "How the score moves" },
  { id: "data", label: "Where the data comes from" },
  { id: "launchpads", label: "Launchpads" },
  { id: "faq", label: "FAQ" },
];

const STEPS = [
  { n: "01", title: "A dev launches", text: "A new coin lands on pump.fun. We are watching the chain, so we see it when it happens." },
  { n: "02", title: "We pull their record", text: "The wallet's earlier coins: how many it launched, how many migrated, and how many are sitting dead." },
  { n: "03", title: "We score the dev", text: "From 1 to 99. Coins that took off add points. Dead coins, launch spam and three coins in an hour take them away." },
  { n: "04", title: "The score becomes a rank", text: "Crazy, Proven, Good, Unknown or Farmer. No essay to read, just one word." },
  { n: "05", title: "You see it before you buy", text: "The rank sits next to the coin on Live, in the Terminal and on the Dev board. Free, no account." },
  { n: "∞", title: "The record follows the wallet", text: "Every new launch is checked again. A wallet that farmed last week still wears it this week." },
];

const RANKS: Record<Tier, { short: string; rule: string }> = {
  crazy: {
    short: "Most of what they launched took off",
    rule: "Reputation 65 or higher, with at least one coin that took off. Most of what this wallet launched before went somewhere.",
  },
  proven: {
    short: "Wins on record, some misses",
    rule: "Reputation 57 to 64. Coins that took off, with some dead ones alongside.",
  },
  good: {
    short: "At least one coin took off",
    rule: "Reputation 50 to 56. At least one coin that took off, among others that did not.",
  },
  unknown: {
    short: "Only one launch on record",
    rule: "Only one launch on record, so there is nothing to judge yet. Also shown while a new dev is still being checked.",
  },
  farmer: {
    short: "2+ launches, nothing took off",
    rule: "Two or more launches and nothing took off, or a reputation under 50. The score says how bad: it drops for mass launching, bursts of coins and dead coins.",
  },
};

const SCORE_RULES: { up: boolean; what: string; points: string }[] = [
  { up: true, what: "Each earlier coin that migrated", points: "+18 for the first, +12 for each after, up to +45" },
  { up: true, what: "Each earlier coin at $10K+ that has not migrated", points: "+10 each, up to +30" },
  { up: true, what: "Share of earlier coins that took off", points: "up to +8" },
  { up: true, what: "Best earlier coin's market cap", points: "+3 at $50K, +6 at $250K, +10 at $1M, +14 at $5M" },
  { up: false, what: "Share of earlier coins that are dead", points: "up to −15" },
  { up: false, what: "4+ earlier coins, nearly all dead, none took off", points: "−10, or −20 from 8 coins" },
  { up: false, what: "5+ coins in total and none took off", points: "−12, or −25 from 10 coins" },
  { up: false, what: "3 or more coins launched inside one hour", points: "−10" },
  { up: false, what: "More than 5 launches a day", points: "−5, or −12 above 15 a day" },
  { up: false, what: "Bot-like wallet (100+ transactions in under 3 days)", points: "−4" },
];

const SOURCES = [
  { title: "Launches come from Solana.", text: "We listen to pump.fun's program through a public Solana node. It does not catch every launch yet, so the lists on this site are a sample of what launches, not all of it." },
  { title: "Coin numbers come from Jupiter.", text: "Market cap, 24-hour volume, migration, holders, fees paid by traders, and each dev's all-time launches and migrations." },
  { title: "DexScreener is the backup.", text: "It fills in market cap and volume when Jupiter cannot be reached." },
  { title: "Launch counts come from Jupiter and Dune.", text: "The numbers on this page and the launches chart are launchpad-wide. Days the chart had to estimate are marked in its tooltip." },
  { title: "ATH is what we have seen.", text: "It is the highest market cap since we started tracking a coin, which can be lower than its true all-time high." },
];

const FAQ = [
  { q: "Will this stop me getting farmed?", a: "No tool can promise that. It shows you who you are dealing with before you buy, which is more than the chart will tell you. What you do with it is up to you." },
  { q: "Does Farmer mean scammer?", a: "No. It means the wallet launched two or more coins and none of them went anywhere. That is a track record, not proof of what the dev intended." },
  { q: "Is this financial advice?", a: "No. A rank describes what a wallet did before. It cannot tell you what its next coin will do." },
  { q: "Does a good rank mean the coin is safe?", a: "No. A dev with a strong record can still launch a coin that goes to zero, and can still sell. Treat the rank as one input, not a green light." },
  { q: "Why is a dev Unknown?", a: "We have only one launch on record for that wallet, so there is no history to judge. Most wallets on pump.fun are in this group." },
  { q: "Can a dev game the rank?", a: "A fresh wallet starts as Unknown, never as Good, and a rank above that needs coins that actually took off. Launching many coins quickly counts against a dev. A dev can always start again with a new wallet, which is one reason Unknown is not a good sign either." },
  { q: "How often do ranks update?", a: "A dev is checked again every time they launch. The market numbers behind each coin refresh every few minutes." },
  { q: "Why does a dev show more launches than I see listed?", a: "The launch count next to a dev is their all-time total from Jupiter. Our own listener only records part of what launches, so the coins listed under a dev can be fewer." },
];

const fmt = (n: number) => n.toLocaleString("en-US");
function usd(n: number | null) {
  if (n === null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

interface ExampleCoin {
  mint: string;
  symbol: string | null;
  mcap: number | null;
  fees: number | null;
  migrated: number;
}

function loadData() {
  ensureCoinsTable();
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // devs per rank, all time
  const devSql = tierSql("verdict", "risk");
  const devBase = `WITH d AS (
    SELECT dev, MAX(dev_verdict) AS verdict, COALESCE(MAX(dev_score), 50) AS risk FROM launches GROUP BY dev
  )`;
  const devCounts = Object.fromEntries(
    TIERS.map((t) => [
      t,
      (db.prepare(`${devBase} SELECT COUNT(*) AS n FROM d WHERE ${devSql[t]}`).get() as { n: number }).n,
    ])
  ) as Record<Tier, number>;

  // share of the launches we recorded in the last 24 hours, by the dev's rank
  const launchSql = tierSql("dev_verdict", "dev_score");
  const dayCounts = Object.fromEntries(
    TIERS.map((t) => [
      t,
      (
        db
          .prepare(`SELECT COUNT(DISTINCT mint) AS n FROM launches WHERE block_time >= ? AND ${launchSql[t]}`)
          .get(now - 86400) as { n: number }
      ).n,
    ])
  ) as Record<Tier, number>;
  const dayTotal = TIERS.reduce((s, t) => s + dayCounts[t], 0);

  // a real wallet with a few coins, at least one of which migrated
  const dev = db
    .prepare(
      `SELECT l.dev FROM launches l JOIN coins c ON c.mint = l.mint
       WHERE c.mcap IS NOT NULL
       GROUP BY l.dev
       HAVING COUNT(DISTINCT l.mint) BETWEEN 4 AND 30 AND MAX(c.migrated) = 1 AND MAX(l.dev_verdict) = 'Legit'
       ORDER BY MAX(c.fees) DESC LIMIT 1`
    )
    .get() as { dev: string } | undefined;
  const example = dev
    ? (db
        .prepare(
          `SELECT l.mint, MAX(l.symbol) AS symbol, c.mcap, c.fees, c.migrated
           FROM launches l JOIN coins c ON c.mint = l.mint
           WHERE l.dev = ? AND c.mcap IS NOT NULL
           GROUP BY l.mint ORDER BY c.migrated DESC, c.mcap DESC LIMIT 6`
        )
        .all(dev.dev) as ExampleCoin[])
    : [];

  return { devCounts, dayCounts, dayTotal, example };
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "good" | "muted" }) {
  return (
    <span
      className="mono rounded-[0.35em] px-[0.5em] py-[0.2em] text-[0.75em]"
      style={
        tone === "good"
          ? { background: "#10261e", color: "#34d399" }
          : { background: "#0f2118", color: "#a1a1aa" }
      }
    >
      {children}
    </span>
  );
}

// Everything on this page is sized in em from one fluid base (set on the page
// root), so type and spacing grow together with the window, like the layout.
const PANEL = "rounded-[0.95em] border border-edge bg-panel";
const BODY = "leading-[1.5] text-zinc-400";

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-[0.65em] mt-[2em] scroll-mt-24 text-[1.7em] font-bold tracking-tight">
      {children}
    </h2>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className={`mb-[1.2em] max-w-[46em] ${BODY}`}>{children}</p>;
}

function Badge({ tier }: { tier: Tier }) {
  return (
    <span
      className="mono inline-flex w-fit items-center gap-[0.6em] rounded-[0.45em] px-[0.7em] py-[0.35em] text-[0.8em] tracking-wider"
      style={{ color: TIER_STYLE[tier].color, background: `${TIER_STYLE[tier].color}1f` }}
    >
      <TierIcon tier={tier} size="1.15em" />
      {TIER_STYLE[tier].label}
    </span>
  );
}

export default async function HowItWorks() {
  // ten queries and a Jupiter call: shared between visitors for 30 seconds
  const { totals, devCounts, dayCounts, dayTotal, example } = await cached("how", 30_000, async () => ({
    totals: await getLaunchTotals24h(),
    ...loadData(),
  }));

  const perDay = totals ? totals.pump + totals.stonk : null;
  const perMin = (n: number | null) => (n === null ? "—" : (n / 1440).toFixed(1));
  const stats = [
    { label: "Launches / minute", value: perMin(perDay), sub: perDay ? `one every ${(86400 / perDay).toFixed(1)}s` : "" },
    { label: "Launches / day", value: perDay === null ? "—" : fmt(perDay), sub: "last 24 hours" },
    { label: "Migrated / day", value: totals ? fmt(totals.pumpMigrated + totals.stonkMigrated) : "—", sub: "completed the curve" },
    { label: "pump.fun / min", value: perMin(totals?.pump ?? null), sub: "" },
    { label: "StonkFun / min", value: perMin(totals?.stonk ?? null), sub: "" },
    { label: "Devs ranked", value: fmt(TIERS.reduce((s, t) => s + devCounts[t], 0)), sub: "on this site" },
  ];

  return (
    <div
      className="mx-auto grid max-w-[2000px] px-[clamp(0px,4.5vw,90px)] pt-[1.6em] lg:grid-cols-[19%_minmax(0,1fr)]"
      style={{ fontSize: "clamp(14px, 0.95vw, 19px)" }}
    >
      {/* titles on the left, in view while the page scrolls */}
      <nav aria-label="On this page" className="sticky top-[88px] hidden self-start pr-[2em] pt-[0.9em] lg:block">
        <div className="text-[0.9em] font-semibold uppercase tracking-[0.12em] text-zinc-500">On this page</div>
        <ul className="mt-[0.9em]">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="block rounded-[0.4em] px-[0.95em] py-[0.55em] text-[0.95em] text-zinc-400 hover:bg-raise hover:text-white"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0">
        <div className="mono text-[0.8em] uppercase tracking-[0.22em] text-matrix/80"><span className="text-matrix/50">{"// "}</span>how it works</div>
        <h1 className="mt-[0.3em] text-[2.3em] font-bold leading-[1.1] tracking-tight sm:text-[3.25em]">
          <Decode text="Devs farm. You pay." />
          <Decode text="We keep the receipts." className="block text-zinc-500" />
        </h1>
        <div className="mt-[1.5em] max-w-[40em] space-y-[0.7em] text-[1.15em] leading-[1.55] text-zinc-300">
          <p>
            You know how it goes. A coin launches, the chart runs for ten minutes, and the wallet
            behind it is already on to the next one.
          </p>
          <p>
            BigBrother watches pump.fun launches as they land, looks up the wallet behind each one,
            and ranks the dev on what they did before: Crazy Dev, Proven, Good, Unknown or Farmer.
          </p>
          <p>One word, next to the coin, before you buy.</p>
        </div>

        <H2 id="loop">The loop</H2>
        <div className="grid gap-[0.95em] sm:grid-cols-2 xl:grid-cols-3">
          {STEPS.map((s, i) => {
            const last = i === STEPS.length - 1;
            return (
              <div
                key={s.n}
                className={`rounded-[0.95em] border p-[1.5em] ${last ? "border-zinc-200 bg-zinc-200 text-bg" : "border-edge bg-panel"}`}
              >
                <div className={`mono text-[0.85em] ${last ? "text-zinc-600" : "text-matrix/70"}`}>{s.n}</div>
                <div className="mt-[1.3em] text-[1.05em] font-semibold">{s.title}</div>
                <p className={`mt-[0.6em] leading-[1.5] ${last ? "text-zinc-700" : "text-zinc-400"}`}>{s.text}</p>
              </div>
            );
          })}
        </div>

        <H2 id="live">Live numbers</H2>
        <Lead>This is how fast coins get printed. Launchpad-wide counts for the last 24 hours, from Jupiter.</Lead>
        <div className="grid grid-cols-2 gap-[0.95em] xl:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className={`${PANEL} p-[1.5em]`}>
              <div className="text-[0.85em] text-zinc-400">{s.label}</div>
              <div className="mono mt-[0.4em] text-[1.7em] font-semibold">{s.value}</div>
              <div className="mt-[0.3em] min-h-[1.5em] text-[0.85em] text-zinc-500">{s.sub}</div>
            </div>
          ))}
        </div>

        <div className={`${PANEL} mt-[0.95em] p-[1.5em]`}>
          <div className="flex flex-wrap items-baseline justify-between gap-[0.5em]">
            <div className="text-[1.05em] font-semibold">Who is launching</div>
            <div className="text-[0.85em] text-zinc-500">
              share of the {fmt(dayTotal)} launches we recorded by dev rank, last 24 hours
            </div>
          </div>
          <div className="mt-[1.2em] space-y-[0.9em]">
            {TIERS.map((t) => {
              const pct = dayTotal > 0 ? (dayCounts[t] / dayTotal) * 100 : 0;
              return (
                <div key={t} className="flex items-center gap-[1em]">
                  <span className="flex w-[9.5em] shrink-0 items-center gap-[0.6em] text-zinc-300">
                    <TierIcon tier={t} size="1.1em" />
                    {NAME[t]}
                  </span>
                  <span className="h-[0.55em] flex-1 overflow-hidden rounded-full bg-chip">
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: TIER_STYLE[t].color }} />
                  </span>
                  <span className="mono w-[3.5em] shrink-0 text-right text-zinc-300">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        <H2 id="colours">Five ranks, five colours</H2>
        <Lead>
          Five colours, used everywhere on the site. See red next to a coin and you already know
          what kind of wallet launched it.
        </Lead>
        <div className={`${PANEL} grid grid-cols-2 overflow-hidden sm:grid-cols-5`}>
          {TIERS.map((t, i) => (
            <div
              key={t}
              className={`flex flex-col items-center px-[1em] py-[1.9em] text-center ${i > 0 ? "sm:border-l sm:border-edge" : ""}`}
            >
              <TierIcon tier={t} size="3.2em" />
              <div className="mt-[1.1em]">
                <Badge tier={t} />
              </div>
              <p className="mt-[0.8em] max-w-[13em] leading-[1.4] text-zinc-400">{RANKS[t].short}</p>
            </div>
          ))}
        </div>

        <H2 id="ranks">The ranks</H2>
        <div className={`${PANEL} overflow-hidden`}>
          {TIERS.map((t, i) => (
            <div
              key={t}
              className={`grid items-center gap-x-[1.6em] gap-y-[0.6em] px-[1.5em] py-[1.2em] sm:grid-cols-[11em_1fr_auto] ${i > 0 ? "border-t border-edge" : ""}`}
            >
              <Badge tier={t} />
              <p className="leading-[1.5] text-zinc-300">{RANKS[t].rule}</p>
              <span className="mono text-[0.85em] text-zinc-500">{fmt(devCounts[t])} devs</span>
            </div>
          ))}
        </div>
        <ul className={`mt-[1.2em] max-w-[52em] list-disc space-y-[0.55em] pl-[1.3em] marker:text-zinc-600 ${BODY}`}>
          <li>A coin &quot;took off&quot; if it migrated off the bonding curve or reached a $10K market cap.</li>
          <li>A coin is &quot;dead&quot; if it never migrated and sits under $3K.</li>
          <li>Wins and dead coins are only counted on coins older than 30 minutes. A coin that just launched has not had time to prove anything.</li>
          <li>Unknown means one launch on record. From the second launch on, a dev always gets a real rank.</li>
        </ul>

        <H2 id="score">How the score moves</H2>
        <Lead>
          Everyone starts at 50. Launch coins that go somewhere and the score climbs. Leave a trail
          of dead coins or spam launches and it sinks. It always stays between 1 and 99.
        </Lead>
        <div className={`${PANEL} overflow-hidden`}>
          {SCORE_RULES.map((r, i) => (
            <div
              key={r.what}
              className={`grid gap-x-[1.5em] gap-y-[0.25em] px-[1.5em] py-[0.9em] sm:grid-cols-[1fr_auto] ${i > 0 ? "border-t border-edge" : ""}`}
            >
              <span className="text-zinc-300">{r.what}</span>
              <span className="mono text-[0.9em]" style={{ color: r.up ? "#34d399" : "#f87171" }}>
                {r.points}
              </span>
            </div>
          ))}
        </div>

        {example.length > 0 && (
          <div className={`${PANEL} mt-[0.95em] overflow-hidden`}>
            <div className="flex flex-wrap items-baseline justify-between gap-[0.5em] px-[1.5em] py-[1.2em]">
              <div className="text-[1.05em] font-semibold">One wallet, {example.length} coins</div>
              <div className="text-[0.85em] text-zinc-500">a real wallet from our records, as its coins stand now</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30em]">
                <thead>
                  <tr className="mono border-t border-edge text-left text-[0.75em] tracking-[0.08em] text-zinc-500">
                    <th className="px-[2em] py-[1em] font-normal">COIN</th>
                    <th className="px-[2em] py-[1em] text-right font-normal">MCAP</th>
                    <th className="px-[2em] py-[1em] text-right font-normal">FEES PAID</th>
                    <th className="px-[2em] py-[1em] text-right font-normal">VERDICT</th>
                  </tr>
                </thead>
                <tbody>
                  {example.map((c) => (
                    <tr key={c.mint} className="border-t border-edge">
                      <td className="px-[1.5em] py-[0.9em] text-zinc-200">{c.symbol ?? "?"}</td>
                      <td className="mono px-[1.5em] py-[0.9em] text-right">{usd(c.mcap)}</td>
                      <td className="mono px-[1.5em] py-[0.9em] text-right">
                        {c.fees === null ? "—" : `${c.fees.toFixed(c.fees >= 10 ? 1 : 2)} SOL`}
                      </td>
                      <td className="px-[1.5em] py-[0.9em] text-right">
                        {c.migrated ? (
                          <Tag tone="good">migrated</Tag>
                        ) : (c.mcap ?? 0) >= 10_000 ? (
                          <Tag tone="good">took off</Tag>
                        ) : (c.mcap ?? 0) < 3_000 ? (
                          <Tag tone="muted">dead</Tag>
                        ) : (
                          <Tag tone="muted">quiet</Tag>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <H2 id="data">Where the data comes from</H2>
        <ol className="max-w-[58em] space-y-[0.7em]">
          {SOURCES.map((s, i) => (
            <li key={s.title} className={`${PANEL} flex gap-[1em] px-[1.3em] py-[1.05em] leading-[1.5]`}>
              <span className="mono mt-[0.15em] flex h-[1.7em] w-[1.7em] shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[0.8em] font-bold text-bg">
                {i + 1}
              </span>
              <span className="text-zinc-400">
                <b className="font-semibold text-zinc-100">{s.title}</b> {s.text}
              </span>
            </li>
          ))}
        </ol>

        <H2 id="launchpads">Launchpads</H2>
        <div className="grid gap-[0.95em] sm:grid-cols-2 xl:grid-cols-3">
          <div className={`${PANEL} p-[1.5em]`}>
            <div className="flex items-center justify-between">
              <span className="text-[1.05em] font-semibold">pump.fun</span>
              <Tag tone="good">live</Tag>
            </div>
            <p className={`mt-[0.6em] ${BODY}`}>
              Bonding-curve coins and their migrations. Every rank on this site is for a pump.fun dev.
            </p>
            <div className="mono mt-[1em] text-[0.85em] text-zinc-500">{perMin(totals?.pump ?? null)} launches / min</div>
          </div>
          <div className={`${PANEL} p-[1.5em]`}>
            <div className="flex items-center justify-between">
              <span className="text-[1.05em] font-semibold">StonkFun</span>
              <Tag tone="muted">SOON</Tag>
            </div>
            <p className={`mt-[0.6em] ${BODY}`}>
              Counted in the launches chart today. Tracking its coins and ranking its devs comes next.
            </p>
            <div className="mono mt-[1em] text-[0.85em] text-zinc-500">{perMin(totals?.stonk ?? null)} launches / min</div>
          </div>
        </div>

        <H2 id="faq">FAQ</H2>
        <div className="border-b border-edge">
          {FAQ.map((f) => (
            <details key={f.q} className="group border-t border-edge">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-[1em] py-[1.1em] text-[1.05em] font-medium [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="text-[1.2em] text-zinc-500 transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className={`max-w-[46em] pb-[1.4em] ${BODY}`}>{f.a}</p>
            </details>
          ))}
        </div>

        <p className="mt-[3em] text-[0.85em] text-zinc-500">
          BigBrother ranks pump.fun devs from on-chain history. Not financial advice.
        </p>
      </div>
    </div>
  );
}
