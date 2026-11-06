/**
 * Shared request handling for /verify and /settle. The two endpoints take the
 * same body and differ only in what they do with it, so parsing, network
 * dispatch and refusal shaping live here rather than being written twice.
 */

import { NextResponse, type NextRequest } from "next/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { networkKeyForCaip2 } from "./facilitator";
import { clientIp, type PreflightResult } from "./guards";
import { NETWORK_KEYS, NETWORKS, type NetworkKey } from "./networks";

type Parsed =
  | { net: NetworkKey; payload: PaymentPayload; requirements: PaymentRequirements; ip: string }
  | { error: NextResponse };

const badRequest = (message: string) =>
  NextResponse.json({ error: "bad_request", message }, { status: 400 });

/**
 * Pulls the payload and requirements out of a facilitator request and resolves
 * which network serves it.
 *
 * `paymentRequirements` is accepted as a top-level field (how x402 clients send
 * it) and falls back to `paymentPayload.accepted`, which carries the same object
 * and is what a hand-rolled caller usually has.
 */
export async function parseFacilitatorRequest(request: NextRequest): Promise<Parsed> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { error: badRequest("Body must be JSON.") };
  }

  const payload = body.paymentPayload as PaymentPayload | undefined;
  if (!payload || typeof payload !== "object") {
    return { error: badRequest("Missing `paymentPayload`.") };
  }

  const requirements = (body.paymentRequirements ?? payload.accepted) as PaymentRequirements | undefined;
  if (!requirements || typeof requirements !== "object") {
    return { error: badRequest("Missing `paymentRequirements` and `paymentPayload.accepted`.") };
  }

  for (const field of ["scheme", "network", "asset", "amount", "payTo"] as const) {
    if (typeof requirements[field] !== "string" || requirements[field].length === 0) {
      return { error: badRequest(`\`paymentRequirements.${field}\` must be a non-empty string.`) };
    }
  }

  const net = networkKeyForCaip2(requirements.network);
  if (!net) {
    const served = NETWORK_KEYS.map((k) => NETWORKS[k].caip2).join(", ");
    return {
      error: NextResponse.json(
        {
          error: "unsupported_network",
          message: `This facilitator serves ${served}. Got "${requirements.network}".`,
        },
        { status: 400 },
      ),
    };
  }

  return { net, payload, requirements, ip: clientIp(request.headers) };
}

/**
 * Turns a non-ok preflight into a response. Protocol-level verdicts come back as
 * a normal x402 response body (shaped by the caller, since verify and settle use
 * different field names); operational refusals come back as 429/503 with
 * `Retry-After` so clients know to back off rather than treating it as invalid.
 */
export function preflightResponse(
  gate: Exclude<PreflightResult, { kind: "ok" }>,
  asProtocolVerdict: (reason: string, message: string) => NextResponse,
): NextResponse {
  if (gate.kind === "reject") return asProtocolVerdict(gate.reason, gate.message);

  const response = NextResponse.json(
    { error: gate.reason, message: gate.message },
    { status: gate.status },
  );
  if (gate.retryAfter !== undefined) {
    response.headers.set("Retry-After", String(gate.retryAfter));
  }
  return response;
}

/**
 * Logs an unexpected failure server-side and returns a generic verdict. The
 * message is not echoed: it can contain the RPC URL (which may carry an API key)
 * or raw payload fragments.
 */
export function errorResponse(
  phase: "verify" | "settle",
  error: unknown,
  asProtocolVerdict: (reason: string, message: string) => NextResponse,
): NextResponse {
  console.error(`[${phase}] unexpected failure:`, (error as Error)?.message ?? error);
  return asProtocolVerdict("unexpected_error", `The facilitator could not complete ${phase}.`);
}
