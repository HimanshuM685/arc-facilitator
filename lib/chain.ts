/**
 * viem plumbing for both Arc networks, plus the EIP-712 domain check that
 * everything else depends on.
 *
 * Why the domain check matters: x402 merchants publish `accepts.extra = { name, version }`
 * and the payer's wallet signs a `TransferWithAuthorization` under that domain. If the
 * domain is off by one character the signature recovers to a different address and
 * *every* payment fails verification — with no on-chain error to point at. So the
 * registry's values are proven against each token's own `DOMAIN_SEPARATOR()`.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  publicActions,
  stringToHex,
  type Account,
  type Chain,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { NETWORKS, type AssetDef, type NetworkDef, type NetworkKey } from "./networks";

const EIP712_DOMAIN_TYPEHASH = keccak256(
  stringToHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
);

export const tokenAbi = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "version", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "DOMAIN_SEPARATOR", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
  {
    type: "function",
    name: "TRANSFER_WITH_AUTHORIZATION_TYPEHASH",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

/**
 * Arc's native token is USDC, and `decimals: 18` here is correct even though
 * the same USDC reads 6 decimals through its ERC-20 interface. Arc exposes one
 * balance behind two interfaces: native (18) and ERC-20 (6), related by 10^12.
 * So `getBalance` returns 18-decimal units and `formatEther`/`parseEther` on it
 * yield plain USDC amounts, while a payment `amount` — and `balanceOf` — are
 * 6-decimal. Never compare the two raw; they are off by a factor of a trillion.
 */
function toViemChain(net: NetworkDef): Chain {
  return defineChain({
    id: net.chainId,
    name: net.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [net.rpc], webSocket: [net.wsRpc] } },
    blockExplorers: { default: { name: "Arc Explorer", url: net.explorer } },
    testnet: net.key === "testnet",
  });
}

const chains = {
  testnet: toViemChain(NETWORKS.testnet),
  mainnet: toViemChain(NETWORKS.mainnet),
} satisfies Record<NetworkKey, Chain>;

export const chainFor = (net: NetworkKey): Chain => chains[net];

const publicClients = new Map<NetworkKey, PublicClient>();

export function publicClientFor(net: NetworkKey): PublicClient {
  let client = publicClients.get(net);
  if (!client) {
    client = createPublicClient({ chain: chains[net], transport: http(NETWORKS[net].rpc) }) as PublicClient;
    publicClients.set(net, client);
  }
  return client;
}

let cachedAccount: Account | undefined;

/** The gas-sponsoring account. Same key on both chains, so one address to fund. */
export function facilitatorAccount(): Account {
  if (!cachedAccount) {
    // Dashboards often store the key quoted, with stray whitespace, or without
    // the 0x that MetaMask's export omits. Accept all of those.
    const raw = process.env.FACILITATOR_PRIVATE_KEY?.trim().replace(/^["']|["']$/g, "").trim();
    if (!raw) throw new Error("FACILITATOR_PRIVATE_KEY is not set");
    const key = raw.startsWith("0x") ? raw : `0x${raw}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error("FACILITATOR_PRIVATE_KEY must be 64 hex characters (with or without 0x)");
    }
    cachedAccount = privateKeyToAccount(key as `0x${string}`);
  }
  return cachedAccount;
}

type FacilitatorSigner = ReturnType<typeof toFacilitatorEvmSigner>;

const signers = new Map<NetworkKey, FacilitatorSigner>();

/**
 * The signer @x402/evm settles with, for one chain.
 *
 * It needs both read and write actions on the same object, plus a top-level
 * `address` — `toFacilitatorEvmSigner` reads `client.address`, which a plain
 * viem wallet client does not have (it exposes `client.account.address`). Hence
 * the wallet client extended with public actions and the address attached.
 */
export function facilitatorSignerFor(net: NetworkKey): FacilitatorSigner {
  let signer = signers.get(net);
  if (!signer) {
    const account = facilitatorAccount();
    const client = createWalletClient({
      account,
      chain: chains[net],
      transport: http(NETWORKS[net].rpc),
    }).extend(publicActions);

    signer = toFacilitatorEvmSigner(
      Object.assign(client, { address: account.address }) as never,
      // Arc finalizes deterministically on inclusion, at ~0.51s blocks, so one
      // confirmation is final and 10s is already generous. A longer wait would
      // only hold the request open while a dropped transaction never arrives.
      { confirmationTimeoutMs: 10_000 },
    );
    signers.set(net, signer);
  }
  return signer;
}

/** Recomputes a token's EIP-712 domain separator from name/version/chainId/address. */
export function computeDomainSeparator(args: {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
}): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
      [
        EIP712_DOMAIN_TYPEHASH,
        keccak256(stringToHex(args.name)),
        keccak256(stringToHex(args.version)),
        BigInt(args.chainId),
        getAddress(args.verifyingContract),
      ],
    ),
  );
}

export type AssetCheck = {
  net: NetworkKey;
  asset: AssetDef;
  onChainSeparator: `0x${string}`;
  /** The name/version pair that actually reproduces the on-chain separator. */
  resolved: { name: string; version: string } | null;
  typehashOk: boolean;
  decimalsOk: boolean;
  /** True when the registry entry matches the chain in every respect. */
  ok: boolean;
};

/**
 * Reads a token's real domain separator and searches candidate name/version pairs
 * for the one that reproduces it. The registry's own values are tried first, so a
 * healthy asset resolves on the first attempt; the extra candidates exist to turn
 * "every signature mysteriously fails" into an actionable diff.
 */
export async function checkAsset(net: NetworkKey, asset: AssetDef): Promise<AssetCheck> {
  const client = publicClientFor(net);
  const read = <T>(functionName: string) =>
    client.readContract({ address: asset.address, abi: tokenAbi, functionName } as never) as Promise<T>;

  const [onChainSeparator, decimals, onChainName, onChainVersion, typehash] = await Promise.all([
    read<`0x${string}`>("DOMAIN_SEPARATOR"),
    read<number>("decimals"),
    read<string>("name").catch(() => null),
    read<string>("version").catch(() => null),
    read<`0x${string}`>("TRANSFER_WITH_AUTHORIZATION_TYPEHASH").catch(() => null),
  ]);

  const names = [asset.domain.name, onChainName, asset.label, "USDC", "USD Coin", "EURC", asset.symbol];
  const versions = [asset.domain.version, onChainVersion, "2", "1"];
  const seen = new Set<string>();
  let resolved: { name: string; version: string } | null = null;

  for (const name of names) {
    if (name == null) continue;
    for (const version of versions) {
      if (version == null) continue;
      // Keyed as JSON so a name containing the separator cannot collide
      // with a different name/version pair.
      const combo = JSON.stringify([name, version]);
      if (seen.has(combo)) continue;
      seen.add(combo);
      const candidate = computeDomainSeparator({
        name,
        version,
        chainId: NETWORKS[net].chainId,
        verifyingContract: asset.address,
      });
      if (candidate.toLowerCase() === onChainSeparator.toLowerCase()) {
        resolved = { name, version };
        break;
      }
    }
    if (resolved) break;
  }

  const typehashOk =
    typehash?.toLowerCase() ===
    "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267";
  const decimalsOk = Number(decimals) === asset.decimals;
  const separatorMatchesRegistry = onChainSeparator.toLowerCase() === asset.domainSeparator.toLowerCase();
  const registryDomainIsCorrect =
    resolved?.name === asset.domain.name && resolved?.version === asset.domain.version;

  return {
    net,
    asset,
    onChainSeparator,
    resolved,
    typehashOk,
    decimalsOk,
    ok: typehashOk && decimalsOk && separatorMatchesRegistry && registryDomainIsCorrect,
  };
}

export async function checkAllAssets(): Promise<AssetCheck[]> {
  const jobs = (Object.keys(NETWORKS) as NetworkKey[]).flatMap((net) =>
    NETWORKS[net].assets.map((asset) => checkAsset(net, asset)),
  );
  return Promise.all(jobs);
}
