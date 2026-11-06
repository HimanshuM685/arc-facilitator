/**
 * End-to-end proof against a running facilitator: an account holding USDC and
 * no gas of its own settles a real payment, and is charged nothing but the
 * amount it authorized.
 *
 * That last assertion is the point of the whole service, and on Arc it takes a
 * different shape than on a chain where gas is a separate token. Arc's gas token
 * *is* USDC — one balance behind two interfaces, native (18 decimals) and ERC-20
 * (6) — so "the payer holds zero gas token" is not a state a paying account can
 * be in. The assertion becomes stronger instead:
 *
 *   the payer's native balance falls by exactly amount x 10^12, and not one wei
 *   more.
 *
 * Any gas charged to the payer would show up as that extra wei. A zero-balance
 * check could only ever prove the payer had nothing to lose; this proves the
 * facilitator paid.
 *
 * The payment payload is built here with the same @x402/evm client a real agent
 * uses, then posted straight to /verify and /settle — so this exercises the
 * facilitator itself rather than any particular merchant integration.
 *
 *   pnpm smoke
 *   pnpm smoke -- --network=mainnet --url=https://facilitator.example
 *
 * Required:
 *   SMOKE_PAYER_PRIVATE_KEY  an account holding USDC. It needs no separate gas
 *                            balance, and must not be the SMOKE_PAY_TO account.
 *   SMOKE_PAY_TO             where the payment lands (an address you control)
 */

import assert from "node:assert/strict";
import { formatEther, formatUnits, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { publicClientFor, tokenAbi } from "../lib/chain";
import { isNetworkKey, NETWORKS, type NetworkKey } from "../lib/networks";

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const network = arg("network", "testnet");
assert.ok(isNetworkKey(network), `--network must be one of: ${Object.keys(NETWORKS).join(", ")}`);
const net: NetworkKey = network;

const baseUrl = arg("url", process.env.NEXT_PUBLIC_FACILITATOR_URL ?? "http://localhost:3000").replace(/\/$/, "");
const amount = arg("amount", "10000");

const key = process.env.SMOKE_PAYER_PRIVATE_KEY;
assert.ok(key, "SMOKE_PAYER_PRIVATE_KEY is not set (see .env.example)");

const payTo = process.env.SMOKE_PAY_TO;
assert.ok(payTo && isAddress(payTo), "SMOKE_PAY_TO must be a valid address you control");

const account = privateKeyToAccount(key as `0x${string}`);
const client = publicClientFor(net);
const asset = NETWORKS[net].assets.find((a) => a.symbol === "USDC");
assert.ok(asset, `USDC is not served on ${NETWORKS[net].name}`);

/** Native (18 dec) per ERC-20 base unit (6 dec): the 10^12 Arc factor. */
const NATIVE_PER_BASE_UNIT = 10n ** 12n;

// A self-payment nets to zero on both sides and would pass every assertion
// below while proving nothing, so refuse it up front.
assert.notEqual(
  payTo.toLowerCase(),
  account.address.toLowerCase(),
  "SMOKE_PAY_TO must differ from the payer; paying yourself proves nothing",
);

console.log(`network   ${NETWORKS[net].name} (${NETWORKS[net].caip2})`);
console.log(`payer     ${account.address}`);
console.log(`payTo     ${payTo}`);
console.log(`amount    ${formatUnits(BigInt(amount), asset.decimals)} ${asset.symbol}`);
console.log(`facilitator ${baseUrl}\n`);

const post = async (path: string, body: unknown) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

/* 1. The facilitator must advertise this network before we try to use it. */

const supported = (await (await fetch(`${baseUrl}/supported`)).json()) as {
  kinds: { scheme: string; network: string }[];
  signers: Record<string, string[]>;
};
assert.ok(
  supported.kinds.some((k) => k.network === NETWORKS[net].caip2 && k.scheme === "exact"),
  `/supported does not advertise exact on ${NETWORKS[net].caip2}`,
);
const signer = supported.signers[NETWORKS[net].caip2]?.[0];
assert.ok(signer, "/supported publishes no signer address");
console.log(`ok  /supported advertises this network, signer ${signer}`);

/* 2. The advertised EIP-712 domain must match the registry. A wrong `extra` is
      the failure that breaks every signature with nothing on-chain to debug. */

const assets = (await (await fetch(`${baseUrl}/assets`)).json()) as {
  networks: { network: string; assets: { address: string; extra: Record<string, string> }[] }[];
};
const published = assets.networks
  .find((n) => n.network === net)
  ?.assets.find((a) => a.address.toLowerCase() === asset.address.toLowerCase());
assert.ok(published, `/assets does not list ${asset.symbol} on ${net}`);
assert.deepEqual(published.extra, asset.domain, "/assets publishes the wrong EIP-712 domain");
console.log(`ok  /assets domain matches: ${JSON.stringify(published.extra)}`);

/* 3. Starting balances. Both views of the payer's one USDC balance, plus the
      facilitator's, so step 6 can attribute every unit that moved. */

const readBalance = (address: `0x${string}`) =>
  client.readContract({
    address: asset.address,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [address],
  }) as Promise<bigint>;

const [payerNativeBefore, payerTokenBefore, merchantTokenBefore, signerNativeBefore] = await Promise.all([
  client.getBalance({ address: account.address }),
  readBalance(account.address),
  readBalance(payTo as `0x${string}`),
  client.getBalance({ address: signer as `0x${string}` }),
]);

console.log(`    payer ${asset.symbol} (native, 18dp)  ${formatEther(payerNativeBefore)}`);
console.log(`    payer ${asset.symbol} (ERC-20, ${asset.decimals}dp)   ${formatUnits(payerTokenBefore, asset.decimals)}`);
console.log(`    signer ${asset.symbol} (native, 18dp) ${formatEther(signerNativeBefore)}`);

assert.ok(payerTokenBefore >= BigInt(amount), `payer holds too little ${asset.symbol}; fund it first`);
assert.ok(
  signerNativeBefore > 0n,
  "the facilitator's signer holds no USDC, so it cannot pay gas — fund it and retry",
);

/* 4. Build the payment the way a real agent would. */

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: NETWORKS[net].caip2,
  asset: asset.address,
  amount,
  payTo,
  maxTimeoutSeconds: 60,
  extra: asset.domain,
};

const paymentRequired: PaymentRequired = {
  x402Version: 2,
  resource: {
    url: `${baseUrl}/smoke`,
    description: "Facilitator smoke test",
    mimeType: "application/json",
  },
  accepts: [requirements],
};

// Arc USDC is already in @x402/evm's default asset registry, so this is a spend
// control rather than an opt-in: it caps what this payload may authorize.
const payload = await x402Client
  .fromConfig({
    schemes: [{ network: NETWORKS[net].caip2, client: new ExactEvmScheme(account) }],
    spendControls: { allowedAssets: [{ network: NETWORKS[net].caip2, asset: asset.address, maxAmountPerPayment: amount }] },
  })
  .createPaymentPayload(paymentRequired);

console.log("ok  signed TransferWithAuthorization (no transaction, no gas)");

/* 5. Verify, then settle. */

const verified = await post("/verify", { paymentPayload: payload, paymentRequirements: requirements });
assert.equal(verified.status, 200, `/verify returned ${verified.status}: ${JSON.stringify(verified.body)}`);
assert.equal(verified.body.isValid, true, `/verify rejected: ${JSON.stringify(verified.body)}`);
assert.equal(
  String(verified.body.payer).toLowerCase(),
  account.address.toLowerCase(),
  "/verify recovered a different payer — check the EIP-712 domain",
);
console.log("ok  /verify accepted, payer recovered correctly");

const started = Date.now();
const settled = await post("/settle", { paymentPayload: payload, paymentRequirements: requirements });
const elapsed = Date.now() - started;

assert.equal(settled.status, 200, `/settle returned ${settled.status}: ${JSON.stringify(settled.body)}`);
assert.equal(settled.body.success, true, `/settle failed: ${JSON.stringify(settled.body)}`);

const txHash = String(settled.body.transaction);
assert.match(txHash, /^0x[0-9a-fA-F]{64}$/, "/settle returned no transaction hash");
console.log(`ok  /settle confirmed in ${elapsed}ms`);
console.log(`    ${NETWORKS[net].explorer}/tx/${txHash}`);

/* 6. The assertions the service exists for. */

const [payerNativeAfter, payerTokenAfter, merchantTokenAfter, signerNativeAfter] = await Promise.all([
  client.getBalance({ address: account.address }),
  readBalance(account.address),
  readBalance(payTo as `0x${string}`),
  client.getBalance({ address: signer as `0x${string}` }),
]);

// The whole proof, in one line: the payer's balance moved by the authorized
// amount and nothing else. Read natively, so a single wei of gas charged to the
// payer would fail it — an amount far below what the 6-decimal ERC-20 view can
// even represent.
const payerNativeSpent = payerNativeBefore - payerNativeAfter;
const authorizedInNative = BigInt(amount) * NATIVE_PER_BASE_UNIT;
assert.equal(
  payerNativeSpent,
  authorizedInNative,
  `payer's native ${asset.symbol} fell by ${formatEther(payerNativeSpent)} but authorized only ` +
    `${formatEther(authorizedInNative)} — the difference is gas charged to the payer`,
);
assert.equal(
  payerTokenBefore - payerTokenAfter,
  BigInt(amount),
  `payer's ${asset.symbol} did not fall by exactly the authorized amount`,
);
assert.equal(
  merchantTokenAfter - merchantTokenBefore,
  BigInt(amount),
  `payTo did not receive exactly the authorized amount — funds went somewhere else`,
);
const signerSpent = signerNativeBefore - signerNativeAfter;
assert.ok(
  signerSpent > 0n,
  "the facilitator's USDC did not decrease, so who paid the gas?",
);

console.log(`ok  payer spent exactly ${formatEther(authorizedInNative)} ${asset.symbol} — no gas charged to it`);
console.log(`ok  ${formatUnits(BigInt(amount), asset.decimals)} ${asset.symbol} moved payer -> payTo`);
console.log(`ok  facilitator paid ${formatEther(signerSpent)} ${asset.symbol} of gas`);

/* 7. And it should be in the public log. */

const logs = (await (await fetch(`${baseUrl}/api/logs?network=${net}&limit=25`)).json()) as {
  rows: { tx_hash: string | null; ok: boolean; gas_cost_wei: string | null }[];
};
const logged = logs.rows.find((row) => row.tx_hash?.toLowerCase() === txHash.toLowerCase());
assert.ok(logged, "settlement is missing from /api/logs");
assert.equal(logged.ok, true);
console.log(`ok  logged, gas recorded as ${formatEther(BigInt(logged.gas_cost_wei ?? "0"))} ${asset.symbol}`);

console.log("\nAll smoke checks passed.");
