"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { formatUnits } from "viem";
import { explorerAddressUrl, findAsset, networkByCaip2, NETWORKS, USDC_ADDRESS } from "@/lib/networks";
import { MerchantIcon } from "./merchant-icon";
import { EASE, Stagger, StaggerItem } from "./motion";
import { CopyButton } from "./net";

type Accept = { scheme: string; network: string; asset: string; amount: string; payTo: string };
type BazaarInfo = {
  info?: {
    input?: { type?: string; method?: string; queryParams?: unknown; body?: unknown; bodyType?: string };
    output?: { type?: string; example?: unknown; schema?: unknown };
  };
  schema?: unknown;
};
type Endpoint = {
  resource: string;
  method: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  accepts: Accept[];
  extensions?: { bazaar?: BazaarInfo };
  settleCount: number;
  verifiedAt: string | null;
};
type Merchant = {
  payTo: string;
  name: string | null;
  website: string | null;
  iconUrl: string | null;
  endpointCount: number;
  settleCount: number;
};

const host = (website: string | null) => {
  try {
    return website ? new URL(website).host : null;
  } catch {
    return null;
  }
};

/** "0.01 USDC on Arc Testnet" from an x402 accepts entry. */
function price(a: Accept): string {
  const net = networkByCaip2(a.network);
  const asset = net ? findAsset(net.key, a.asset) : undefined;
  const value = asset ? formatUnits(BigInt(a.amount), asset.decimals) : a.amount;
  return `${value} ${asset?.symbol ?? "units"}${net ? ` on ${net.name}` : ""}`;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

function Block({ label, code }: { label: string; code: string }) {
  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-line px-3 py-1.5">
        <span className="font-mono text-[11px] text-chalk-dim">{label}</span>
        <CopyButton text={code} />
      </div>
      <pre className="max-h-72 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-chalk">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function agentSnippet(e: Endpoint): string {
  const a = e.accepts[0];
  const input = e.extensions?.bazaar?.info?.input;
  const query = input?.queryParams && typeof input.queryParams === "object" ? (input.queryParams as Record<string, unknown>) : null;
  const target = query
    ? `\`${e.resource}?\${new URLSearchParams(${json(Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])))})}\``
    : `"${e.resource}"`;
  const body = input?.body;
  // Encode the example body the way the endpoint declared it takes it.
  const encoded =
    input?.bodyType === "form-data"
      ? `Object.entries(${json(body ?? {}).replace(/\n/g, "\n  ")}).reduce((form, [k, v]) => (form.append(k, String(v)), form), new FormData())`
      : input?.bodyType === "text"
        ? JSON.stringify(typeof body === "string" ? body : JSON.stringify(body ?? ""))
        : `JSON.stringify(${body ? json(body).replace(/\n/g, "\n  ") : "{}"})`;
  const contentType =
    input?.bodyType === "form-data" ? "" : input?.bodyType === "text" ? "text/plain" : "application/json";
  const init =
    e.method === "GET"
      ? ""
      : `, {\n  method: "${e.method}",\n${contentType ? `  headers: { "content-type": "${contentType}" },\n` : ""}  body: ${encoded},\n}`;
  return `import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as \`0x\${string}\`);

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: "${a?.network ?? NETWORKS.testnet.caip2}", client: new ExactEvmScheme(account) }],
  spendControls: {
    allowedAssets: [{ network: "${a?.network ?? NETWORKS.testnet.caip2}", asset: "${a?.asset ?? USDC_ADDRESS}", maxAmountPerPayment: "${a?.amount ?? "10000"}" }],
  },
});

const response = await fetchWithPayment(${target}${init});
console.log(await response.json());`;
}

function EndpointCard({ e }: { e: Endpoint }) {
  const info = e.extensions?.bazaar?.info;
  const input = info?.input;
  const inputExample = input?.body ?? input?.queryParams;
  const path = (() => {
    try {
      return new URL(e.resource).pathname;
    } catch {
      return e.resource;
    }
  })();

  return (
    <article className="glass p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded border border-white/20 px-2 py-0.5 font-mono text-[11px] text-white">{e.method}</span>
        <h3 className="font-mono text-[15px] tracking-[-0.01em] text-white">{path}</h3>
        <span className="ml-auto rounded-full border border-mainnet/40 px-2 py-0.5 text-[10.5px] text-mainnet">
          verified
        </span>
      </div>

      {e.description && <p className="mt-3 max-w-2xl text-sm text-[#cfcfcf]">{e.description}</p>}

      <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-chalk-dim">URL</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <code className="truncate font-mono text-[12px] text-white">{e.resource}</code>
          <CopyButton text={e.resource} />
        </dd>
        <dt className="text-chalk-dim">Price</dt>
        <dd className="text-white">{e.accepts.map(price).join(" · ") || "—"}</dd>
        {e.mimeType && (
          <>
            <dt className="text-chalk-dim">Returns</dt>
            <dd className="font-mono text-[12px] text-white">{e.mimeType}</dd>
          </>
        )}
        <dt className="text-chalk-dim">Paid</dt>
        <dd className="text-white">
          {e.settleCount} time{e.settleCount === 1 ? "" : "s"} through this facilitator
        </dd>
      </dl>

      {e.tags && e.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {e.tags.map((t) => (
            <span key={t} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-chalk-dim">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {inputExample !== undefined && <Block label={`Input · ${input?.bodyType ?? "query"}`} code={json(inputExample)} />}
        {info?.output?.example !== undefined && <Block label="Output example" code={json(info.output.example)} />}
        {info?.output?.schema !== undefined && <Block label="Output schema" code={json(info.output.schema)} />}
      </div>

      <details className="mt-5">
        <summary className="cursor-pointer text-sm text-chalk-dim transition-colors hover:text-white">
          Call it from an agent
        </summary>
        <div className="mt-3">
          <Block label="agent.ts" code={agentSnippet(e)} />
        </div>
      </details>
    </article>
  );
}

/** One merchant (pay-to address): who they are, and documentation for each verified endpoint. */
export function MerchantPage({ payTo }: { payTo: string }) {
  const [data, setData] = useState<{ merchant: Merchant; endpoints: Endpoint[] } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  useEffect(() => {
    fetch(`/api/bazaar/${payTo}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404 || r.status === 400) return setState("missing");
        if (!r.ok) throw new Error(String(r.status));
        setData(await r.json());
        setState("ready");
      })
      .catch(() => setState("error"));
  }, [payTo]);

  if (state !== "ready" || !data) {
    return (
      <div className="glass px-5 py-12 text-center text-sm text-chalk-dim">
        {state === "loading" && "Loading…"}
        {state === "error" && "Could not read the Bazaar."}
        {state === "missing" && (
          <>
            No verified endpoints for this address.{" "}
            <Link href="/bazaar" className="underline underline-offset-4 hover:text-white">
              Back to the Bazaar
            </Link>
          </>
        )}
      </div>
    );
  }

  const { merchant, endpoints } = data;
  const name = merchant.name ?? host(merchant.website) ?? `${merchant.payTo.slice(0, 6)}…${merchant.payTo.slice(-4)}`;
  const net = networkByCaip2(endpoints[0]?.accepts[0]?.network ?? "");

  return (
    <div>
      <Stagger gap={0.1} className="mb-10">
        <StaggerItem>
          <Link href="/bazaar" className="text-xs text-chalk-dim transition-colors hover:text-white">
            ← Bazaar
          </Link>
        </StaggerItem>
        <StaggerItem className="mt-5 flex flex-wrap items-center gap-4">
          <MerchantIcon iconUrl={merchant.iconUrl} website={merchant.website} name={name} size={56} />
          <div className="min-w-0">
            <h1 className="page-title">{name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-chalk-dim">
              {merchant.website && (
                <a href={merchant.website} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">
                  {host(merchant.website)} ↗
                </a>
              )}
              <a
                href={net ? explorerAddressUrl(net.key, merchant.payTo) : "#"}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[12px] transition-colors hover:text-white"
              >
                pay-to {merchant.payTo}
              </a>
            </div>
          </div>
        </StaggerItem>
        <StaggerItem>
          <p className="page-lede">
            {endpoints.length} verified x402 endpoint{endpoints.length === 1 ? "" : "s"}. Each one was checked by calling it:
            its live 402 pays this address. Re-checked every 10 payments or daily.
          </p>
        </StaggerItem>
      </Stagger>

      <motion.div
        className="space-y-6"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.2 } } }}
      >
        {endpoints.map((e) => (
          <motion.div
            key={`${e.method} ${e.resource}`}
            variants={{
              hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
              show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE } },
            }}
          >
            <EndpointCard e={e} />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
