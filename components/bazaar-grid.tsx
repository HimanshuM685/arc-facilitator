"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { MerchantIcon } from "./merchant-icon";
import { EASE } from "./motion";
import { useNetwork } from "./network-provider";

type Merchant = {
  payTo: string;
  name: string | null;
  website: string | null;
  iconUrl: string | null;
  endpointCount: number;
  settleCount: number;
  lastVerifiedAt: string | null;
};

const host = (website: string | null) => {
  try {
    return website ? new URL(website).host : null;
  } catch {
    return null;
  }
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Merchant cards for the selected network, live from /api/bazaar. */
export function BazaarGrid() {
  const { key, net } = useNetwork();
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setMerchants(null);
    fetch(`/api/bazaar?network=${key}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { merchants: Merchant[] }) => !cancelled && (setMerchants(body.merchants), setError(false)))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!merchants || !q) return merchants;
    return merchants.filter((m) =>
      [m.name, m.website, m.payTo].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [merchants, query]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search merchants, sites or addresses"
          className="field max-w-sm"
        />
        <span className="text-xs text-chalk-dim">
          {shown ? `${shown.length} merchant${shown.length === 1 ? "" : "s"} on ${net.name}` : ""}
        </span>
      </div>

      {error && <p className="glass px-5 py-10 text-center text-sm text-chalk-dim">Could not read the Bazaar.</p>}

      {!error && shown && shown.length === 0 && (
        <div className="glass px-5 py-12 text-center">
          <p className="text-sm text-white">No verified merchants on {net.name} yet.</p>
          <p className="mt-2 text-xs text-chalk-dim">
            Accept a payment through this facilitator, or{" "}
            <Link href="/docs/bazaar" className="underline underline-offset-4 hover:text-white">
              register your endpoints
            </Link>
            .
          </p>
        </div>
      )}

      {!error && !shown && <p className="py-10 text-center text-sm text-chalk-dim">Loading…</p>}

      <motion.ul
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        initial="hidden"
        animate={shown ? "show" : "hidden"}
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
      >
        <AnimatePresence>
          {shown?.map((m) => {
            const name = m.name ?? host(m.website) ?? short(m.payTo);
            return (
              <motion.li
                key={m.payTo}
                layout
                variants={{
                  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
                  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE } },
                }}
                exit={{ opacity: 0, scale: 0.97 }}
              >
                <Link
                  href={`/bazaar/${m.payTo}`}
                  className="glass group flex h-full flex-col gap-4 p-5 transition-colors hover:border-white/25 hover:bg-white/[0.05]"
                >
                  <div className="flex items-center gap-3">
                    <MerchantIcon iconUrl={m.iconUrl} website={m.website} name={name} />
                    <div className="min-w-0">
                      <p className="truncate font-medium tracking-[-0.02em] text-white">{name}</p>
                      <p className="truncate text-xs text-chalk-dim">{host(m.website) ?? short(m.payTo)}</p>
                    </div>
                    <span className="ml-auto shrink-0 rounded-full border border-mainnet/40 px-2 py-0.5 text-[10.5px] text-mainnet">
                      verified
                    </span>
                  </div>
                  <div className="mt-auto flex items-center justify-between font-mono text-[11px] text-chalk-dim">
                    <span>
                      {m.endpointCount} endpoint{m.endpointCount === 1 ? "" : "s"} · {m.settleCount} paid
                    </span>
                    <span className="transition-transform group-hover:translate-x-1">→</span>
                  </div>
                </Link>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>
    </div>
  );
}
