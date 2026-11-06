import { NextResponse } from "next/server";
import { formatEther } from "viem";
import { facilitatorAccount, publicClientFor } from "@/lib/chain";
import { dbHealthy } from "@/lib/db";
import { config } from "@/lib/guards";
import { NETWORK_KEYS, NETWORKS, type NetworkKey } from "@/lib/networks";
import { safeErrorMessage } from "@/lib/redact";

export const dynamic = "force-dynamic";

/** A typical EIP-3009 settle costs ~85k gas; used to turn USDC into "settles left". */
const TYPICAL_SETTLE_GAS = 85_000n;

type NetworkHealth = {
  network: NetworkKey;
  caip2: string;
  status: "ok" | "degraded" | "disabled";
  detail?: string;
  blockNumber?: string;
  /** The signer's USDC, from its native (18-decimal) balance. Same money an
   * ERC-20 `balanceOf` would show at 6 decimals. */
  balanceUsdc?: string;
  gasPriceGwei?: string;
  estimatedSettlesLeft?: number;
};

const safeMessage = (error: unknown) => safeErrorMessage(error, 160);

async function networkHealth(net: NetworkKey, signer: `0x${string}`): Promise<NetworkHealth> {
  const base = { network: net, caip2: NETWORKS[net].caip2 } as const;

  if (net === "mainnet" && !config.mainnetEnabled) {
    return { ...base, status: "disabled", detail: "MAINNET_ENABLED is not true; /verify still works." };
  }

  const client = publicClientFor(net);
  let balance: bigint, blockNumber: bigint, gasPrice: bigint;
  try {
    [balance, blockNumber, gasPrice] = await Promise.all([
      client.getBalance({ address: signer }),
      client.getBlockNumber(),
      client.getGasPrice(),
    ]);
  } catch (error) {
    return { ...base, status: "degraded", detail: `RPC unreachable: ${safeMessage(error)}` };
  }

  const perSettle = gasPrice * TYPICAL_SETTLE_GAS;
  const lowBalance = balance < config.minSignerBalanceWei;

  return {
    ...base,
    status: lowBalance ? "degraded" : "ok",
    detail: lowBalance ? "Signer USDC balance is below the operating floor." : undefined,
    blockNumber: blockNumber.toString(),
    balanceUsdc: formatEther(balance),
    gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(2),
    estimatedSettlesLeft: perSettle > 0n ? Number(balance / perSettle) : 0,
  };
}

/**
 * GET /health — operational state per network. Safe to expose publicly: it
 * reveals the signer address (which is on-chain anyway) and balances, never a key.
 */
export async function GET() {
  let signer: `0x${string}`;
  try {
    signer = facilitatorAccount().address;
  } catch (error) {
    return NextResponse.json(
      { status: "degraded", detail: (error as Error).message, networks: [] },
      { status: 503 },
    );
  }

  const [networks, db] = await Promise.all([
    Promise.all(NETWORK_KEYS.map((net) => networkHealth(net, signer))),
    dbHealthy(),
  ]);

  // The database only holds the public log; settlement works without it.
  const degraded = networks.some((n) => n.status === "degraded");
  return NextResponse.json(
    { status: degraded ? "degraded" : "ok", signer, db: db ? "ok" : "unreachable", networks },
    { status: degraded ? 503 : 200 },
  );
}
