import { NextResponse } from "next/server";
import { cardText, getCard } from "@/lib/card";

export const dynamic = "force-dynamic";

/** The card for a pasted contract address or coin link. */
export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 500);
  const result = await getCard(q);
  if ("error" in result) return NextResponse.json(result, { status: 404 });
  return NextResponse.json({ card: result.card, text: cardText(result.card) });
}
