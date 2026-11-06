import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getMerchant, toDiscoveryResource } from "@/lib/bazaar";

export const dynamic = "force-dynamic";

/** GET /api/bazaar/0x… — one merchant and its verified endpoints. */
export async function GET(_request: Request, { params }: { params: Promise<{ payTo: string }> }) {
  const { payTo } = await params;
  // Any letter case is fine; a checksum is not required to look a merchant up.
  if (!isAddress(payTo, { strict: false })) {
    return NextResponse.json({ error: "bad_request", message: "Not an address." }, { status: 400 });
  }
  try {
    const found = await getMerchant(payTo);
    if (!found) return NextResponse.json({ error: "not_found", message: "No verified endpoints for this address." }, { status: 404 });
    return NextResponse.json({
      merchant: found.merchant,
      endpoints: found.endpoints.map((row) => ({
        ...toDiscoveryResource(row),
        method: row.method,
        settleCount: row.settle_count,
        verifiedAt: row.verified_at,
      })),
    });
  } catch (error) {
    console.error("[api/bazaar/payTo]", (error as Error).message);
    return NextResponse.json({ error: "db_unavailable", message: "Could not read the Bazaar." }, { status: 503 });
  }
}
