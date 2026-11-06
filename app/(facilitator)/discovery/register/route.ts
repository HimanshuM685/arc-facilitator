import { NextResponse, type NextRequest } from "next/server";
import { parseRegistration, registerMerchant } from "@/lib/bazaar";
import { clientIp, hit } from "@/lib/guards";

export const dynamic = "force-dynamic";
// Each endpoint is checked live (≤5s each, in parallel).
export const maxDuration = 30;

/**
 * POST /discovery/register — a merchant's own code tells the facilitator
 * "this is my pay-to address, these are my x402 endpoints".
 *
 *   { "payTo": "0x…", "name": "Acme", "website": "https://acme.com",
 *     "endpoints": ["https://acme.com/x402/top-up", { "url": "https://acme.com/x402/report", "method": "POST" }] }
 *
 * We call every endpoint; each is listed only if its live 402 pays that same
 * address on a network we serve. Calling again re-checks everything.
 */
export async function POST(request: NextRequest) {
  // Registration makes us fetch strangers' URLs, so it is rate limited per IP.
  const limited = hit(`bazaar-register:${clientIp(request.headers)}`, 6);
  if (limited !== null) {
    const response = NextResponse.json(
      { error: "rate_limited", message: "Too many registrations. Try again shortly." },
      { status: 429 },
    );
    response.headers.set("Retry-After", String(limited));
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Body must be JSON." }, { status: 400 });
  }

  const parsed = parseRegistration(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: "bad_request", message: parsed.error }, { status: 400 });
  }

  try {
    const result = await registerMerchant(parsed.input);
    const listed = result.endpoints.filter((e) => e.status === "verified").length;
    return NextResponse.json({ ...result, listed, page: `/bazaar/${result.merchant.payTo}` });
  } catch (error) {
    console.error("[discovery/register]", (error as Error).message);
    return NextResponse.json({ error: "db_unavailable", message: "Could not save the registration." }, { status: 503 });
  }
}
