/**
 * One x402Facilitator per network.
 *
 * Why not one instance for both: `FacilitatorEvmSigner` has no chain argument on
 * `readContract`/`writeContract`, so a signer is bound to exactly one chain.
 * Requests are therefore dispatched on `paymentPayload.accepted.network`.
 *
 * All verification and settlement logic lives in @x402/evm — EIP-712 recovery
 * (including EIP-1271 smart wallets), balance checks, simulation, nonce handling
 * and `settlement_pending` reconciliation. None of it is reimplemented here;
 * this file wires it to a signer and hangs logging off the lifecycle hooks.
 */

import { x402Facilitator } from "@x402/core/facilitator";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedKind,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { recordSettle } from "./bazaar";
import { facilitatorSignerFor, publicClientFor } from "./chain";
import { logPayment } from "./db";
import { config } from "./guards";
import { findAsset, NETWORK_KEYS, NETWORKS, networkByCaip2, type NetworkKey } from "./networks";
import { safeErrorMessage } from "./redact";

/** Shared fields pulled out of a payload for the log, minus anything replayable. */
function describe(payload: PaymentPayload, requirements: PaymentRequirements, net: NetworkKey) {
  return {
    network: requirements.network,
    scheme: requirements.scheme,
    asset: requirements.asset,
    asset_symbol: findAsset(net, requirements.asset)?.symbol ?? null,
    pay_to: requirements.payTo,
    amount: requirements.amount,
    resource: payload.resource?.url ?? null,
  };
}

/**
 * Arc's minimum base fee, 20 Gwei. Used only as a fallback when a receipt omits
 * `effectiveGasPrice`, so the public log never reports a zero-cost settlement.
 *
 * The number matters beyond this fallback: Arc's mempool *silently drops* a
 * transaction whose `maxFeePerGas` is under 20 Gwei. No error, no receipt, it
 * simply never appears in a block. viem's own fee estimation sits above the
 * floor (measured 24-29 Gwei), so we do not override it — but anything that
 * ever hardcodes a fee here must stay above this line.
 */
const FLOOR_GAS_PRICE_WEI = 20_000_000_000n;

/**
 * Settlement gas actually spent, read from the receipt, for the public log.
 * SettleResponse does not carry it. Null if the receipt cannot be read.
 */
async function receiptCost(net: NetworkKey, txHash: string) {
  try {
    const receipt = await publicClientFor(net).waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
      timeout: 8_000,
    });
    const price = receipt.effectiveGasPrice ?? FLOOR_GAS_PRICE_WEI;
    return { gas_used: receipt.gasUsed.toString(), gas_cost_wei: (receipt.gasUsed * price).toString() };
  } catch {
    return { gas_used: null, gas_cost_wei: null };
  }
}

const NO_COST = { gas_used: null, gas_cost_wei: null };

function build(net: NetworkKey): x402Facilitator {
  // Advertise the Bazaar discovery extension in /supported; the catalog itself is lib/bazaar.ts.
  const facilitator = new x402Facilitator().registerExtension({ key: "bazaar" });

  const signer = facilitatorSignerFor(net);

  registerExactEvmScheme(facilitator, {
    signer: {
      ...signer,
      // Hard gas ceiling on every settlement (MAX_SETTLE_GAS). Without it viem
      // uses its own estimate, so a token upgrade or pathological transfer
      // could burn any amount of our USDC. An EIP-3009 transfer uses 70–90k.
      writeContract: (args) =>
        signer.writeContract({
          ...args,
          gas: args.gas !== undefined && args.gas < config.maxSettleGas ? args.gas : config.maxSettleGas,
        }),
    },
    networks: NETWORKS[net].caip2,
    // Re-simulate inside settle so a payment that would revert on-chain is
    // never broadcast. Costs one extra eth_call; saves a wasted USDC fee.
    // This earns its keep on Arc specifically: USDC enforces its blocklist at
    // runtime, so a transfer touching a blocklisted address reverts and still
    // consumes gas. Simulating first turns that into a verdict, not a bill.
    simulateInSettle: true,
  });

  const started = new WeakMap<object, number>();
  const elapsed = (key: object) => {
    const at = started.get(key);
    return at === undefined ? null : Date.now() - at;
  };

  // Only settlements are logged. Verification spends nothing and moves no
  // money, so it would only add noise to the public log.
  return facilitator
    .onBeforeSettle(async (ctx) => {
      started.set(ctx.paymentPayload, Date.now());
    })
    .onAfterSettle(async ({ paymentPayload, requirements, result }) => {
      // Measured before the receipt lookup below, so it is the settle itself.
      const latency = elapsed(paymentPayload);
      const cost = result.transaction ? await receiptCost(net, result.transaction) : NO_COST;
      await logPayment(net, {
        kind: "settle",
        ok: result.success,
        error_reason: result.errorReason ?? null,
        payer: result.payer ?? null,
        tx_hash: result.transaction || null,
        latency_ms: latency,
        ...cost,
        ...describe(paymentPayload, requirements, net),
      });
      // A real settled payment lists the paid endpoint in the Bazaar (once verified).
      if (result.success) await recordSettle(paymentPayload, requirements);
    })
    .onSettleFailure(async ({ paymentPayload, requirements, error }) => {
      await logPayment(net, {
        kind: "settle",
        ok: false,
        // Redacted: this row is served publicly by /api/logs, and a raw viem
        // error carries the RPC URL and the decoded call arguments — including
        // the payer's signature.
        error_reason: safeErrorMessage(error),
        // Public address from the authorization; nothing replayable.
        payer: (paymentPayload.payload as { authorization?: { from?: string } }).authorization?.from ?? null,
        tx_hash: null,
        latency_ms: elapsed(paymentPayload),
        ...NO_COST,
        ...describe(paymentPayload, requirements, net),
      });
    });
}

const instances = new Map<NetworkKey, x402Facilitator>();

export function facilitatorFor(net: NetworkKey): x402Facilitator {
  let instance = instances.get(net);
  if (!instance) {
    instance = build(net);
    instances.set(net, instance);
  }
  return instance;
}

/** Maps a CAIP-2 identifier off the wire to the network that serves it. */
export function networkKeyForCaip2(caip2: unknown): NetworkKey | undefined {
  return typeof caip2 === "string" ? networkByCaip2(caip2)?.key : undefined;
}

export type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse };

/**
 * The merged `/supported` body: both networks from one URL, since the network
 * travels inside the payload rather than in the endpoint.
 */
export function supported(): SupportedResponse {
  const kinds: SupportedKind[] = [];
  const signers: Record<string, string[]> = {};
  const extensions = new Set<string>();

  for (const net of NETWORK_KEYS) {
    // A network with no servable asset would let a merchant's resource server
    // initialize against it, then fail every payment with unsupported_asset.
    if (NETWORKS[net].assets.length === 0) continue;
    const result = facilitatorFor(net).getSupported();
    // Each instance also advertises the v1 EVM networks it inherited from
    // `registerExactEvmScheme`; we only serve Arc, so filter to ours.
    // Re-stating `network` from the registry keeps it the CAIP-2 literal type
    // rather than the loose `string` the library declares.
    kinds.push(
      ...result.kinds
        .filter((kind) => kind.network === NETWORKS[net].caip2)
        .map((kind) => ({ ...kind, network: NETWORKS[net].caip2 })),
    );

    // @x402/core keys signers by CAIP family ("eip155:*"), while the spec
    // describes them as CAIP-2 keyed. Publish both so a client looking up either
    // the family or the concrete network finds the address that pays its gas.
    for (const [key, addresses] of Object.entries(result.signers)) {
      signers[key] = [...new Set([...(signers[key] ?? []), ...addresses])];
      const concrete = NETWORKS[net].caip2;
      signers[concrete] = [...new Set([...(signers[concrete] ?? []), ...addresses])];
    }

    for (const extension of result.extensions) extensions.add(extension);
  }

  return { kinds, extensions: [...extensions], signers };
}
