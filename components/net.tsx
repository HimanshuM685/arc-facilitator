"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { NETWORKS, type NetworkKey } from "@/lib/networks";
import { useNetwork } from "./network-provider";

/**
 * Every network-specific value the docs ever need, in one map.
 *
 * This is what keeps the documentation a single tree instead of a mainnet copy
 * and a testnet copy: prose is written once and the addresses, chain ids and
 * code samples are substituted from here according to the header toggle.
 */
export function networkTokens(key: NetworkKey): Record<string, string> {
  const net = NETWORKS[key];
  const usdc = net.assets.find((a) => a.symbol === "USDC");
  const none = "not available on this network";

  return {
    network: key,
    networkName: net.name,
    caip2: net.caip2,
    chainId: String(net.chainId),
    chainIdHex: `0x${net.chainId.toString(16)}`,
    rpc: net.rpc,
    wsRpc: net.wsRpc,
    explorer: net.explorer,
    bridge: net.bridge,
    faucet: net.faucet ?? "—",
    asset: usdc?.address ?? none,
    assetSymbol: "USDC",
    assetDecimals: String(usdc?.decimals ?? 6),
    assetDomainName: usdc?.domain.name ?? none,
    assetDomainVersion: usdc?.domain.version ?? none,
    assetDomainSeparator: usdc?.domainSeparator ?? none,
    usdc: usdc?.address ?? none,
    facilitatorUrl: process.env.NEXT_PUBLIC_FACILITATOR_URL ?? "https://your-facilitator.example",
  };
}

function substitute(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => tokens[name] ?? match);
}

/** Inline network-specific value, e.g. `<NetVal k="usdc" />`. */
export function NetVal({ k, mono = true }: { k: string; mono?: boolean }) {
  const { key } = useNetwork();
  const value = networkTokens(key)[k] ?? `{{${k}}}`;
  return <span className={mono ? "font-mono text-[0.85em] text-chalk" : undefined}>{value}</span>;
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="cursor-pointer rounded-md border border-[rgba(198,198,198,0.35)] bg-black/50 px-2 py-1 font-mono text-[11px] text-chalk-dim transition-colors hover:border-[rgba(220,230,255,0.7)] hover:text-white"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/**
 * A code block whose `{{token}}` placeholders are filled from the selected
 * network, so a reader on mainnet copies mainnet addresses and never has to
 * hand-edit a testnet sample.
 */
export function NetCode({
  children,
  lang,
  filename,
}: {
  children: string;
  lang?: string;
  filename?: string;
}) {
  const { key } = useNetwork();
  const code = substitute(children.trim(), networkTokens(key));

  return (
    <motion.div
      className="glass my-4 overflow-hidden"
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -40px 0px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-ink-line px-3 py-1.5">
        <span className="font-mono text-[11px] text-chalk-dim">{filename ?? lang ?? "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed text-chalk">
        <code>{code}</code>
      </pre>
    </motion.div>
  );
}

/** Short, copyable value with a label — for addresses and URLs in reference tables. */
export function NetField({ label, k }: { label: string; k: string }) {
  const { key } = useNetwork();
  const value = networkTokens(key)[k] ?? "—";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-ink-line py-2 last:border-0">
      <span className="text-sm text-chalk-dim">{label}</span>
      <span className="flex items-center gap-2">
        <code className="font-mono text-[12px] break-all text-chalk">{value}</code>
        {value !== "—" && <CopyButton text={value} />}
      </span>
    </div>
  );
}

/** Content shown only on one network — for faucet steps, mainnet warnings, and such. */
export function OnlyOn({ network, children }: { network: NetworkKey; children: React.ReactNode }) {
  const { key } = useNetwork();
  return key === network ? <>{children}</> : null;
}
