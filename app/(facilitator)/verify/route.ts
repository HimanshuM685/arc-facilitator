import { NextResponse, type NextRequest } from "next/server";
import { facilitatorFor } from "@/lib/facilitator";
import { parseFacilitatorRequest, preflightResponse, errorResponse } from "@/lib/facilitator-http";
import { preflight } from "@/lib/guards";
import { safeErrorMessage } from "@/lib/redact";

export const dynamic = "force-dynamic";

/**
 * POST /verify — x402 v2 facilitator verification. Read-only: recovers the
 * EIP-712 signature, checks balance and the validity window, and simulates the
 * transfer. Never broadcasts, so it spends no gas and is cheap to call.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseFacilitatorRequest(request);
  if ("error" in parsed) return parsed.error;
  const { net, payload, requirements, ip } = parsed;

  const gate = await preflight({
    net,
    phase: "verify",
    ip,
    scheme: requirements.scheme,
    network: requirements.network,
    asset: requirements.asset,
    amount: requirements.amount,
    payTo: requirements.payTo,
  });

  if (gate.kind !== "ok") {
    return preflightResponse(gate, (reason, message) =>
      NextResponse.json({ isValid: false, invalidReason: reason, invalidMessage: message }),
    );
  }

  try {
    const result = await facilitatorFor(net).verify(payload, requirements);
    // The library copies raw viem errors into `invalidMessage` — RPC URL included.
    return NextResponse.json(result.invalidMessage ? { ...result, invalidMessage: safeErrorMessage(result.invalidMessage) } : result);
  } catch (error) {
    return errorResponse("verify", error, (reason, message) =>
      NextResponse.json({ isValid: false, invalidReason: reason, invalidMessage: message }, { status: 500 }),
    );
  }
}
