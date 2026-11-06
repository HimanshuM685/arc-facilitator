import { NextResponse, type NextRequest } from "next/server";
import { listVerified, refreshStale, toDiscoveryResource } from "@/lib/bazaar";

export const dynamic = "force-dynamic";

const int = (v: string | null, fallback: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};

/**
 * GET /discovery/resources — the x402 Bazaar catalog, in the official
 * `DiscoveryResourcesResponse` shape read by `withBazaar(client).extensions.bazaar.listResources()`.
 * Only endpoints whose live 402 we have verified are listed.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const limit = int(q.get("limit"), 20, 100) || 20;
  const offset = int(q.get("offset"), 0, 100_000);
  try {
    const { rows, total } = await listVerified({
      limit,
      offset,
      type: q.get("type") ?? undefined,
      payTo: q.get("payTo") ?? undefined,
      network: q.get("network") ?? undefined,
    });
    refreshStale();
    return NextResponse.json({ x402Version: 2, items: rows.map(toDiscoveryResource), pagination: { limit, offset, total } });
  } catch (error) {
    console.error("[discovery/resources]", (error as Error).message);
    return NextResponse.json({ error: "db_unavailable", message: "Could not read the Bazaar." }, { status: 503 });
  }
}
