import { NextResponse, type NextRequest } from "next/server";
import { listMerchants, refreshStale } from "@/lib/bazaar";
import { isNetworkKey, NETWORKS } from "@/lib/networks";

export const dynamic = "force-dynamic";

/** GET /api/bazaar?network=testnet — merchant cards for the /bazaar page. */
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get("network");
  const network = isNetworkKey(key) ? NETWORKS[key].caip2 : undefined;
  try {
    const merchants = await listMerchants({ network });
    refreshStale();
    return NextResponse.json({ merchants });
  } catch (error) {
    console.error("[api/bazaar]", (error as Error).message);
    return NextResponse.json({ error: "db_unavailable", message: "Could not read the Bazaar." }, { status: 503 });
  }
}
