/**
 * Bitquery GraphQL client — fetches historical daily pump.fun launch counts
 * from the `archive` dataset.
 *
 * Requires BITQUERY_API_KEY in .env. IMPORTANT: archive (historical) queries
 * are a paid Bitquery feature — keys on the realtime-only free trial will
 * return an error, which this module surfaces clearly.
 *
 * Query: pump.fun `create`/`create_v2` instructions on program
 * 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P, grouped per UTC day.
 */

const ENDPOINT = process.env.BITQUERY_ENDPOINT ?? "https://streaming.bitquery.io/graphql";
const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const REQUEST_TIMEOUT_MS = 60_000; // archive aggregates can be slow

export interface DailyCreateCount {
  date: string; // YYYY-MM-DD (UTC)
  count: number;
}

const DAILY_CREATES_QUERY = /* GraphQL */ `
  query DailyPumpFunCreates($since: DateTime!, $till: DateTime!) {
    Solana(dataset: archive) {
      Instructions(
        where: {
          Instruction: {
            Program: {
              Address: { is: "${PUMP_PROGRAM_ID}" }
              Method: { in: ["create", "create_v2"] }
            }
          }
          Transaction: { Result: { Success: true } }
          Block: { Time: { since: $since, till: $till } }
        }
        limit: { count: 200 }
      ) {
        Block {
          Time(interval: { in: days, count: 1 })
        }
        count
      }
    }
  }
`;

interface BitqueryResponse {
  // Bitquery returns results at the top level, not under `data`
  Solana?: {
    Instructions?: { Block?: { Time?: string | null }; count?: number | null }[];
  } | null;
  errors?: { message: string }[];
}

function toUtcDate(datetime: string): string | null {
  // Bitquery returns e.g. "2026-07-10 00:00:00 +0000 UTC" or ISO8601 —
  // both start with the date when UTC. Normalize to YYYY-MM-DD.
  const m = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function isBitqueryConfigured(): boolean {
  return !!process.env.BITQUERY_API_KEY;
}

async function graphql(
  query: string,
  variables: Record<string, unknown>
): Promise<BitqueryResponse> {
  const key = process.env.BITQUERY_API_KEY;
  if (!key) throw new Error("BITQUERY_API_KEY not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Bitquery auth failed — check BITQUERY_API_KEY");
    }
    if (!res.ok) {
      throw new Error(`Bitquery HTTP ${res.status}`);
    }
    return (await res.json()) as BitqueryResponse;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Daily pump.fun token creations between since/till (ISO8601, UTC).
 * Returns per-day counts, oldest first.
 */
export async function fetchDailyPumpFunCreates(
  sinceIso: string,
  tillIso: string
): Promise<DailyCreateCount[]> {
  const body = await graphql(DAILY_CREATES_QUERY, { since: sinceIso, till: tillIso });
  if (body.errors && body.errors.length > 0) {
    const msg = body.errors.map((e) => e.message).join("; ");
    if (/archive|dataset|plan|subscription/i.test(msg)) {
      throw new Error(
        `Bitquery archive access missing on this key (paid feature): ${msg}`
      );
    }
    throw new Error(`Bitquery GraphQL error: ${msg}`);
  }
  const rows = body.Solana?.Instructions ?? [];
  const out: DailyCreateCount[] = [];
  for (const r of rows) {
    const t = r.Block?.Time;
    const date = t ? toUtcDate(t) : null;
    const count = r.count ?? 0;
    if (date && count > 0) out.push({ date, count });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
