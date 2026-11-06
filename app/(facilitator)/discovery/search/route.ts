import { NextResponse, type NextRequest } from "next/server";
import { listVerified, toDiscoveryResource } from "@/lib/bazaar";

export const dynamic = "force-dynamic";

/**
 * GET /discovery/search?query=… — text search over the verified catalog, in the
 * official `SearchDiscoveryResourcesResponse` shape (`extensions.bazaar.search()`).
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const query = (q.get("query") ?? "").trim().slice(0, 200);
  if (!query) {
    return NextResponse.json({ error: "bad_request", message: "`query` is required." }, { status: 400 });
  }
  const limit = Math.min(Math.max(Number(q.get("limit")) || 20, 1), 100);
  try {
    const { rows, total } = await listVerified({
      query,
      limit,
      offset: 0,
      type: q.get("type") ?? undefined,
      payTo: q.get("payTo") ?? undefined,
      network: q.get("network") ?? undefined,
    });
    return NextResponse.json({
      x402Version: 2,
      resources: rows.map(toDiscoveryResource),
      partialResults: total > rows.length,
      pagination: null,
    });
  } catch (error) {
    console.error("[discovery/search]", (error as Error).message);
    return NextResponse.json({ error: "db_unavailable", message: "Could not search the Bazaar." }, { status: 503 });
  }
}
