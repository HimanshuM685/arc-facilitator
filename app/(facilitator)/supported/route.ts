import { NextResponse } from "next/server";
import { supported } from "@/lib/facilitator";

export const dynamic = "force-dynamic";

/**
 * GET /supported — scheme/network discovery. Both Arc networks are
 * advertised from this one URL, because x402 carries the network inside the
 * payment payload rather than in the facilitator endpoint.
 */
export async function GET() {
  try {
    return NextResponse.json(supported());
  } catch (error) {
    // Reaching here means the service is misconfigured — building the response
    // needs the signer, so a missing FACILITATOR_PRIVATE_KEY lands here. Say so
    // plainly instead of returning an opaque 500 that looks like an outage.
    console.error("[supported] cannot build response:", (error as Error).message);
    return NextResponse.json(
      {
        error: "not_configured",
        message: "This facilitator is not fully configured. See /health.",
      },
      { status: 503 },
    );
  }
}
