"use client";

/**
 * Browser version of `pnpm smoke`: a wallet signs an EIP-3009 authorization
 * with the same @x402/evm client an agent uses, and the payload is posted
 * straight to this facilitator's /verify and /settle.
 *
 * The wallet only signs typed data — it never sends a transaction, so the payer
 * needs USDC to spend and no gas balance at all.
 *
 * On Arc that claim cannot be shown as a zero balance, because gas *is* USDC:
 * the payer's gas token and payment token are one asset behind two interfaces,
 * native (18 decimals) and ERC-20 (6). So the panel reads both views of the one
 * balance and proves the stronger thing instead — that the payer's balance moved
 * by exactly the authorized amount and not one wei more.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type EIP1193Provider,
} from "viem";
import { x402Client } from "@x402/core/client";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { chainFor, tokenAbi } from "@/lib/chain";
import { explorerTxUrl } from "@/lib/networks";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "./motion";
import { useNetwork } from "./network-provider";

// One entrance for everything that appears in the results panel.
const appear = {
  initial: { opacity: 0, y: 10, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.5, ease: EASE },
} as const;
const panel = {
  hidden: { opacity: 0, y: 18, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/**
 * One balance, both views. `native` is the 18-decimal native USDC balance
 * (what gas is deducted from); `token` is the same money through the ERC-20
 * interface at 6 decimals (what a payment amount is denominated in).
 */
type Balances = { native: bigint; token: bigint };

/** Native (18 dec) per ERC-20 base unit (6 dec): the 10^12 Arc factor. */
const NATIVE_PER_BASE_UNIT = 10n ** 12n;
type Step = { label: string; status: number | null; ms: number; body: unknown };

const field = "field";
const button = "btn btn-ghost";

export function TestPayment() {
  const { key, net } = useNetwork();
  const chain = chainFor(key);
  const publicClient = useMemo(() => createPublicClient({ chain, transport: http(net.rpc) }), [chain, net.rpc]);

  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [assetAddress, setAssetAddress] = useState(net.assets[0]?.address ?? "");
  const [amount, setAmount] = useState("0.01");
  const [payTo, setPayTo] = useState("");
  const [balances, setBalances] = useState<Balances | null>(null);
  const [before, setBefore] = useState<Balances | null>(null);
  const [payload, setPayload] = useState<{ payment: PaymentPayload; requirements: PaymentRequirements } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const asset = net.assets.find((a) => a.address === assetAddress) ?? net.assets[0];

  // Switching network invalidates the asset choice and any signed payload.
  useEffect(() => {
    setAssetAddress(net.assets[0]?.address ?? "");
    setPayload(null);
    setSteps([]);
    setBefore(null);
  }, [net]);

  const refresh = useCallback(async () => {
    if (!account || !asset) return null;
    const [native, token] = await Promise.all([
      publicClient.getBalance({ address: account }),
      publicClient.readContract({ address: asset.address, abi: tokenAbi, functionName: "balanceOf", args: [account] }) as Promise<bigint>,
    ]);
    const next = { native, token };
    setBalances(next);
    return next;
  }, [account, asset, publicClient]);

  useEffect(() => {
    refresh().catch(() => setBalances(null));
  }, [refresh]);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError((e as { shortMessage?: string }).shortMessage ?? (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run("connect", async () => {
      if (!window.ethereum) throw new Error("No browser wallet found. Install MetaMask or similar.");
      const [address] = (await window.ethereum.request({ method: "eth_requestAccounts" })) as `0x${string}`[];
      if (!address) throw new Error("Wallet returned no account.");
      setAccount(address);
      setPayTo((current) => current || address);
    });

  const sign = () =>
    run("sign", async () => {
      if (!window.ethereum || !account || !asset) return;
      if (!isAddress(payTo)) throw new Error("payTo is not a valid address.");

      const wallet = createWalletClient({ account, chain, transport: custom(window.ethereum) });
      // The chain id is part of the EIP-712 domain; most wallets refuse to sign
      // typed data for a chain other than the active one.
      try {
        await wallet.switchChain({ id: chain.id });
      } catch {
        await wallet.addChain({ chain });
      }

      const requirements: PaymentRequirements = {
        scheme: "exact",
        network: net.caip2,
        asset: asset.address,
        amount: parseUnits(amount, asset.decimals).toString(),
        payTo,
        maxTimeoutSeconds: 120,
        extra: asset.domain,
      };
      const paymentRequired: PaymentRequired = {
        x402Version: 2,
        resource: { url: `${window.location.origin}/test`, description: "Facilitator test page", mimeType: "application/json" },
        accepts: [requirements],
      };

      const signer = {
        address: account,
        signTypedData: (message: Parameters<typeof wallet.signTypedData>[0]) => wallet.signTypedData(message),
      };
      // Arc USDC is already in @x402/evm's default asset registry, so this
      // `allowedAssets` entry is not an opt-in — it is a spend control, capping
      // what this payload may authorize. Same config the agent docs show.
      const payment = await x402Client
        .fromConfig({
          schemes: [{ network: net.caip2, client: new ExactEvmScheme(signer as never) }],
          spendControls: {
            allowedAssets: [{ network: net.caip2, asset: asset.address, maxAmountPerPayment: requirements.amount }],
          },
        })
        .createPaymentPayload(paymentRequired);

      setPayload({ payment, requirements });
      setSteps([]);
      setBefore(await refresh());
    });

  const post = (path: "/verify" | "/settle") =>
    run(path, async () => {
      if (!payload) return;
      const started = performance.now();
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentPayload: payload.payment, paymentRequirements: payload.requirements }),
      });
      const body = await response.json().catch(() => null);
      setSteps((s) => [...s, { label: path, status: response.status, ms: Math.round(performance.now() - started), body }]);
      if (path === "/settle") await refresh();
    });

  const tx = [...steps].reverse().find((s) => s.label === "/settle")?.body as { transaction?: string } | undefined;

  return (
    <motion.div
      className="mt-8 grid gap-6 lg:grid-cols-2"
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.25 } } }}
    >
      <motion.section variants={panel} className="glass space-y-4 p-6">
        <h2 className="eyebrow">1 · Wallet</h2>
        <AnimatePresence mode="wait" initial={false}>
        {account ? (
          <motion.div key="account" {...appear} className="space-y-1 font-mono text-xs">
            <div className="break-all">{account}</div>
            {balances && asset && (
              <div className="space-y-0.5 text-chalk-dim">
                <div>
                  {formatUnits(balances.token, asset.decimals)} {asset.symbol}{" "}
                  <span className="opacity-60">· ERC-20 view, {asset.decimals} decimals</span>
                </div>
                <div>
                  {formatEther(balances.native)} {asset.symbol}{" "}
                  <span className="opacity-60">· native view, 18 decimals — the same balance</span>
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.button whileTap={{ scale: 0.97 }} className="btn btn-solid" onClick={connect} disabled={busy !== null}>
            Connect wallet
          </motion.button>
        )}
        </AnimatePresence>

        <h2 className="pt-2 eyebrow">2 · Payment</h2>
        <label className="block space-y-1 text-xs text-chalk-dim">
          Asset
          <select className={field} value={assetAddress} onChange={(e) => setAssetAddress(e.target.value as `0x${string}`)}>
            {net.assets.map((a) => (
              <option key={a.address} value={a.address}>
                {a.symbol} · {a.address}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs text-chalk-dim">
          Amount ({asset?.symbol})
          <input className={field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </label>
        <label className="block space-y-1 text-xs text-chalk-dim">
          Pay to (defaults to your own address)
          <input className={field} value={payTo} onChange={(e) => setPayTo(e.target.value.trim())} placeholder="0x…" />
        </label>

        <div className="flex flex-wrap gap-2 pt-2">
          <motion.button whileTap={{ scale: 0.97 }} className={button} onClick={sign} disabled={!account || !asset || busy !== null}>
            {busy === "sign" ? "Signing…" : "Sign authorization"}
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} className={button} onClick={() => post("/verify")} disabled={!payload || busy !== null}>
            {busy === "/verify" ? "Verifying…" : "Verify"}
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} className="btn btn-solid" onClick={() => post("/settle")} disabled={!payload || busy !== null}>
            {busy === "/settle" ? "Settling…" : "Settle"}
          </motion.button>
        </div>

        {!asset && (
          <p className="text-xs text-danger">
            No allowlisted asset on {net.name}, so there is nothing to settle here.
          </p>
        )}
        {account && payTo && payTo.toLowerCase() === account.toLowerCase() && (
          <p className="text-xs text-testnet">
            Paying yourself. The call still settles, but both balances net to zero, so it cannot
            show that gas was sponsored. Use a different <code>payTo</code> for that.
          </p>
        )}
        <AnimatePresence>
          {error && (
            <motion.p key={error} {...appear} className="text-xs break-words text-danger">
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </motion.section>

      <motion.section variants={panel} layout="size" className="glass space-y-4 p-6">
        <h2 className="eyebrow">3 · Results</h2>
        <AnimatePresence mode="popLayout">
        {!payload && (
          <motion.p key="empty" {...appear} className="text-xs text-chalk-dim">
            Sign an authorization to begin. Signing costs nothing.
          </motion.p>
        )}

        {payload && (
          <motion.details key="payload" {...appear} className="text-xs">
            <summary className="cursor-pointer text-chalk-dim">Signed payload</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-ink-line bg-black/60 p-3 font-mono text-[11px]">
              {JSON.stringify(payload.payment, null, 2)}
            </pre>
          </motion.details>
        )}

        {steps.map((step, i) => (
          <motion.div key={`step-${i}`} {...appear} className="text-xs">
            <div className="font-mono">
              <span className="text-white">{step.label}</span>{" "}
              <span className={step.status === 200 ? "text-mainnet" : "text-danger"}>{step.status}</span>{" "}
              <span className="text-chalk-dim">{step.ms}ms</span>
            </div>
            <pre className="mt-1 max-h-64 overflow-auto rounded-lg border border-ink-line bg-black/60 p-3 font-mono text-[11px]">
              {JSON.stringify(step.body, null, 2)}
            </pre>
          </motion.div>
        ))}

        {tx?.transaction && (
          <motion.a
            key="tx"
            {...appear}
            className="block font-mono text-xs break-all text-mainnet hover:underline"
            href={explorerTxUrl(key, tx.transaction)}
            target="_blank"
            rel="noreferrer"
          >
            {tx.transaction} ↗
          </motion.a>
        )}

        {tx?.transaction && before && balances && asset && payload && account && (() => {
          const nativeDelta = balances.native - before.native;
          // What the payer's balance should move by if the facilitator paid the
          // gas: exactly the authorized amount, scaled into native units. A
          // self-payment nets to zero, so it proves nothing either way.
          const selfPay = payTo.toLowerCase() === account.toLowerCase();
          const expected = selfPay ? 0n : -(BigInt(payload.requirements.amount) * NATIVE_PER_BASE_UNIT);
          const sponsored = nativeDelta === expected;
          return (
            <motion.div key="diff" {...appear} className="space-y-1 font-mono text-xs text-chalk-dim">
              <div>
                {asset.symbol} (ERC-20 view): {formatUnits(balances.token - before.token, asset.decimals)}
              </div>
              <div className={sponsored ? "text-mainnet" : "text-danger"}>
                {asset.symbol} (native view): {formatEther(nativeDelta)}
              </div>
              <div className={sponsored ? "text-mainnet" : "text-danger"}>
                {selfPay
                  ? sponsored
                    ? "net zero, as expected for a self-payment"
                    : `expected 0, got ${formatEther(nativeDelta)} — the payer was charged gas`
                  : sponsored
                    ? "moved by exactly the authorized amount — the payer paid no gas"
                    : `expected ${formatEther(expected)} — the difference is gas the payer paid`}
              </div>
            </motion.div>
          );
        })()}
        </AnimatePresence>
      </motion.section>
    </motion.div>
  );
}
