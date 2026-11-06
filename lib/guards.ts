/**
 * Everything that can stop a payment before it costs us gas.
 *
 * The facilitator's private key is the only asset at risk, and only for gas —
 * but on Arc that gas is USDC, and on mainnet it is real money. A relayer that
 * sponsors anything it's handed is a gas faucet for spam. So every request runs
 * `preflight` before the x402 libraries are touched.
 *
 * Two distinct kinds of refusal, kept separate on purpose:
 *   - `reject`  a protocol-level verdict ("this payment is not acceptable").
 *               Returned as a normal x402 VerifyResponse/SettleResponse.
 *   - `http`    an operational refusal (rate limited, signer empty, degraded).
 *               Returned as 429/503 so callers can back off and retry later.
 */

import { parseEther } from "viem";
import { facilitatorAccount, publicClientFor } from "./chain";
import { findAsset, NETWORKS, type AssetDef, type NetworkKey } from "./networks";

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Reads a USDC amount from the environment into 18-decimal native units.
 * `parseEther` is right here, not `parseUnits(..., 6)`: the value is compared
 * against `getBalance`, which on Arc returns the native (18-decimal) view of
 * the signer's USDC. See `toViemChain` in lib/chain.ts.
 */
const usdc = (name: string, fallback: string): bigint => parseEther(process.env[name] ?? fallback);

export const config = {
  mainnetEnabled: process.env.MAINNET_ENABLED === "true",
  // 6-decimal base units, matching a payment `amount`. The default 10000 is
  // 0.01 USDC. On Arc that floor is directly comparable to the gas it guards
  // against, because both sides are USDC: a settle costs ~0.0017-0.0022 USDC
  // (70-90k gas at Arc's 20 Gwei minimum base fee), so 0.01 clears it ~5x.
  minAmountBaseUnits: BigInt(process.env.MIN_AMOUNT_BASE_UNITS ?? "10000"),
  maxSettleGas: BigInt(process.env.MAX_SETTLE_GAS ?? "300000"),
  rateLimit: {
    ip: num("RATE_LIMIT_IP_PER_MIN", 120),
    payer: num("RATE_LIMIT_PAYER_PER_MIN", 30),
    payTo: num("RATE_LIMIT_PAYTO_PER_MIN", 120),
    global: num("RATE_LIMIT_GLOBAL_PER_MIN", 1200),
  },
  minSignerBalanceWei: usdc("MIN_SIGNER_BALANCE_USDC", "0.05"),
} as const;

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

type Bucket = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
// ponytail: per-process counters. Correct for a single instance; if we ever run
// more than one replica, move these to a Postgres counter or Redis.
const buckets = new Map<string, Bucket>();

/** Returns seconds until reset when the key is over its limit, else null. */
export function hit(key: string, limit: number): number | null {
  if (limit <= 0) return null;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    if (buckets.size > 10_000) prune(now);
    return null;
  }
  existing.count += 1;
  return existing.count > limit ? Math.ceil((existing.resetAt - now) / 1000) : null;
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Test seam — resets all rate-limit state. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Client IP for rate-limit bucketing.
 *
 * Order matters for correctness, not preference. The first three headers are
 * written by the platform and overwrite whatever the caller sent, so they are
 * trustworthy. `x-forwarded-for` is last because a caller can send their own —
 * and if we read it first, anyone could mint a fresh bucket per request by
 * varying it. It is only safe when a proxy you control rewrites it.
 *
 * The per-payer and per-payTo limits are unaffected either way: those addresses
 * come from the signed payload, not from a header.
 */
const TRUSTED_IP_HEADERS = ["x-vercel-forwarded-for", "cf-connecting-ip", "x-real-ip"] as const;

export function clientIp(headers: Headers): string {
  for (const header of TRUSTED_IP_HEADERS) {
    const value = headers.get(header);
    if (value) return value.split(",")[0]!.trim();
  }
  const forwarded = headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0]!.trim() : "unknown";
}

/* ------------------------------------------------------------------ *
 * Preflight
 * ------------------------------------------------------------------ */

export type PreflightInput = {
  net: NetworkKey;
  phase: "verify" | "settle";
  ip: string;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  payer?: string;
};

export type PreflightResult =
  | { kind: "ok"; asset: AssetDef }
  | { kind: "reject"; reason: string; message: string }
  | { kind: "http"; status: 429 | 503; reason: string; message: string; retryAfter?: number };

/**
 * Runs every cheap check, in rising order of cost: string comparisons first,
 * then in-memory counters, then (settle only) RPC and database reads.
 */
export async function preflight(input: PreflightInput): Promise<PreflightResult> {
  const net = NETWORKS[input.net];

  if (input.network !== net.caip2) {
    return {
      kind: "reject",
      reason: "unsupported_network",
      message: `This facilitator serves ${net.caip2}, not ${input.network}.`,
    };
  }

  if (input.scheme !== "exact") {
    return {
      kind: "reject",
      reason: "unsupported_scheme",
      message: `Only the "exact" scheme is supported, got "${input.scheme}".`,
    };
  }

  // An asset is matched within one network only, so a mainnet address presented
  // as a testnet payment (or vice versa) is not allowlisted.
  const asset = findAsset(input.net, input.asset);
  if (!asset) {
    return {
      kind: "reject",
      reason: "unsupported_asset",
      message:
        `${input.asset} is not allowlisted on ${net.name}. ` +
        `Allowed: ${net.assets.map((a) => `${a.symbol} ${a.address}`).join(", ")}.`,
    };
  }

  let amount: bigint;
  try {
    amount = BigInt(input.amount);
  } catch {
    return { kind: "reject", reason: "invalid_amount", message: `Amount "${input.amount}" is not an integer.` };
  }

  if (amount < config.minAmountBaseUnits) {
    const min = Number(config.minAmountBaseUnits) / 10 ** asset.decimals;
    return {
      kind: "reject",
      reason: "amount_below_minimum",
      message: `Minimum sponsored payment is ${min} ${asset.symbol}; gas would exceed the transfer.`,
    };
  }

  const limited =
    hit(`global`, config.rateLimit.global) ??
    hit(`ip:${input.ip}`, config.rateLimit.ip) ??
    hit(`payto:${input.payTo.toLowerCase()}`, config.rateLimit.payTo) ??
    (input.payer ? hit(`payer:${input.payer.toLowerCase()}`, config.rateLimit.payer) : null);

  if (limited !== null) {
    return {
      kind: "http",
      status: 429,
      reason: "rate_limited",
      message: "Too many requests. Nothing was broadcast.",
      retryAfter: limited,
    };
  }

  // Verification is read-only and spends no gas, so the remaining checks —
  // all of which are about our ability to pay — only apply to settlement.
  if (input.phase === "verify") return { kind: "ok", asset };

  if (input.net === "mainnet" && !config.mainnetEnabled) {
    return {
      kind: "http",
      status: 503,
      reason: "mainnet_disabled",
      message: "Mainnet settlement is currently disabled on this facilitator. Verification still works.",
      retryAfter: 3600,
    };
  }

  // One RPC read so an empty wallet is a clear 503 rather than a failed broadcast.
  // No gas budget: settlement is capped only by what the signer holds. This is
  // the signer's native (18-decimal) USDC balance — the same balance an ERC-20
  // `balanceOf` would show at 6 decimals.
  let balance: bigint;
  try {
    balance = await publicClientFor(input.net).getBalance({ address: facilitatorAccount().address });
  } catch (error) {
    console.error(`[preflight] signer balance unreadable on ${input.net}:`, (error as Error).message);
    return {
      kind: "http",
      status: 503,
      reason: "signer_unavailable",
      message: "The facilitator's signer or RPC is unavailable, so settlement is refused. Nothing was broadcast. See /health.",
      retryAfter: 30,
    };
  }

  if (balance < config.minSignerBalanceWei) {
    return {
      kind: "http",
      status: 503,
      reason: "signer_balance_low",
      message: `Facilitator USDC balance on ${net.name} is below the operating floor. Nothing was broadcast.`,
      retryAfter: 300,
    };
  }

  return { kind: "ok", asset };
}
