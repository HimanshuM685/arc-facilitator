import { NextResponse, type NextRequest } from "next/server";
import { listPayments } from "@/lib/db";
import { explorerTxUrl, isNetworkKey, NETWORKS } from "@/lib/networks";

export const dynamic = "force-dynamic";

/**
 * GET /api/logs?network=testnet&limit=50&payer=0x..&payTo=0x..
 *
 * Settlements only.
 *
 * Powers the public log page. Reads from the selected network's table only, so
 * the mainnet and testnet views never bleed into each other.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const network = params.get("network") ?? "testnet";

  if (!isNetworkKey(network)) {
    return NextResponse.json({ error: "unknown_network", message: `Unknown network "${network}".` }, { status: 400 });
  }

  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);

  try {
    const rows = await listPayments({
      net: network,
      limit,
      before: params.get("before") ?? undefined,
      address: params.get("address") ?? undefined,
      payer: params.get("payer") ?? undefined,
      payTo: params.get("payTo") ?? undefined,
    });

    return NextResponse.json({
      network,
      explorer: NETWORKS[network].explorer,
      rows: rows.map((row) => ({
        ...row,
        txUrl: row.tx_hash ? explorerTxUrl(network, row.tx_hash) : null,
      })),
      // Only a full page can have more behind it; a short page is the last one.
      nextBefore: rows.length === limit ? rows[rows.length - 1]!.cursor : null,
    });
  } catch (error) {
    console.error("[api/logs]", (error as Error).message);
    return NextResponse.json({ error: "db_unavailable", message: "Could not read the payment log." }, { status: 503 });
  }
}
