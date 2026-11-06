/**
 * Single source of truth for Arc networks and the assets this facilitator will
 * sponsor gas for. Everything else — viem clients, guards, docs components, the
 * DB table names, the /assets endpoint — reads from here.
 *
 * USDC is the only stablecoin served, and on Arc it is also the gas token. The
 * payer's USDC moves by exactly the amount they signed for; the facilitator's
 * own USDC pays the fee. Same asset, two wallets, and the payer never needs a
 * gas balance of any kind.
 *
 * Only EIP-3009 assets belong in `assets`. The facilitator settles exclusively
 * via `transferWithAuthorization`, so a token without it simply cannot be paid
 * gaslessly. See `scripts/verify-assets.ts`, which proves every entry below
 * against the chain.
 */

export type NetworkKey = "testnet" | "mainnet";

export type AssetDef = {
  symbol: string;
  /** Human label for the UI and docs. */
  label: string;
  address: `0x${string}`;
  /**
   * Decimals of the token's **ERC-20 interface**, which is what a payment
   * amount is denominated in. On Arc this is 6 for USDC, while the same
   * balance read as a native value carries 18 — see `lib/chain.ts`.
   */
  decimals: number;
  /**
   * EIP-712 domain the token actually signs with — what merchants must put in
   * `accepts.extra`. Not guessable from `name()`: bridged Circle tokens often
   * display one name and sign with another. Asserted against the on-chain
   * `DOMAIN_SEPARATOR()` by `verify-assets.ts` and at boot.
   */
  domain: { name: string; version: string };
  /** Expected on-chain DOMAIN_SEPARATOR(), as a tripwire against silent upgrades. */
  domainSeparator: `0x${string}`;
};

export type NetworkDef = {
  key: NetworkKey;
  /** CAIP-2 identifier used on the wire by x402. */
  caip2: `eip155:${number}`;
  chainId: number;
  name: string;
  rpc: string;
  wsRpc: string;
  explorer: string;
  bridge: string;
  faucet: string | null;
  /** Neon table for this network's payment log. A literal — never request input. */
  table: "payments_testnet" | "payments_mainnet";
  assets: AssetDef[];
};

/** Canonical EIP-3009 TransferWithAuthorization typehash. Every asset must match. */
export const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267" as const;

/**
 * Arc's USDC address is the same on both networks: it is a predeploy at
 * `0x3600…`, the optional ERC-20 interface over the native USDC balance, not a
 * separately deployed token. There is no wrapped USDC on Arc and no second
 * address to confuse it with.
 *
 * Because the address is shared, it is the CAIP-2 check in `preflight` — not
 * the address — that stops a testnet authorization being replayed as a mainnet
 * payment. The EIP-712 domain separators below differ for the same reason:
 * `chainId` is part of the domain, so a signature is bound to one network.
 */
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

export const NETWORKS: Record<NetworkKey, NetworkDef> = {
  testnet: {
    key: "testnet",
    caip2: "eip155:5042002",
    chainId: 5042002,
    name: "Arc Testnet",
    rpc: process.env.RPC_URL_TESTNET ?? "https://rpc.testnet.arc.io",
    wsRpc: "wss://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
    bridge: "https://bridge.usdc.com",
    faucet: "https://faucet.circle.com",
    table: "payments_testnet",
    assets: [
      {
        symbol: "USDC",
        label: "USD Coin",
        address: USDC_ADDRESS,
        decimals: 6,
        // Circle's FiatToken signs with the bare ticker, not "USD Coin".
        domain: { name: "USDC", version: "2" },
        domainSeparator: "0x361191522483d32a83e70ae7183b4b9629442c13a78bc9921d6f707911c8c6b0",
      },
    ],
  },
  mainnet: {
    key: "mainnet",
    caip2: "eip155:5042",
    chainId: 5042,
    name: "Arc",
    rpc: process.env.RPC_URL_MAINNET ?? "https://rpc.mainnet.arc.io",
    wsRpc: "wss://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    bridge: "https://bridge.usdc.com",
    faucet: null,
    table: "payments_mainnet",
    assets: [
      {
        symbol: "USDC",
        label: "USD Coin",
        address: USDC_ADDRESS,
        decimals: 6,
        domain: { name: "USDC", version: "2" },
        // Same token, same address, different separator: chainId 5042, not 5042002.
        domainSeparator: "0x940506929bba468048a19b567f4f0d534714bc06604b5c3017e5d16785ccdf84",
      },
    ],
  },
};

export const NETWORK_KEYS = Object.keys(NETWORKS) as NetworkKey[];

/** Narrows an untrusted string to a NetworkKey. */
export function isNetworkKey(value: unknown): value is NetworkKey {
  return typeof value === "string" && value in NETWORKS;
}

/** Resolves a CAIP-2 identifier from the wire to a network, or undefined. */
export function networkByCaip2(caip2: string): NetworkDef | undefined {
  return NETWORK_KEYS.map((k) => NETWORKS[k]).find((n) => n.caip2 === caip2);
}

/**
 * Looks up an allowlisted asset by address within a single network.
 * Address comparison is case-insensitive.
 *
 * On Arc both networks share USDC's address, so unlike a chain with distinct
 * token deployments this lookup does not itself separate the networks — the
 * CAIP-2 comparison earlier in `preflight` does. A signature still cannot
 * cross networks: `chainId` is part of the EIP-712 domain it was signed under.
 */
export function findAsset(net: NetworkKey, address: string): AssetDef | undefined {
  const wanted = address.toLowerCase();
  return NETWORKS[net].assets.find((a) => a.address.toLowerCase() === wanted);
}

export function explorerTxUrl(net: NetworkKey, txHash: string): string {
  return `${NETWORKS[net].explorer}/tx/${txHash}`;
}

export function explorerAddressUrl(net: NetworkKey, address: string): string {
  return `${NETWORKS[net].explorer}/address/${address}`;
}
