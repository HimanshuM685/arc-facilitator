"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther, formatUnits } from "viem";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "./motion";
import { useNetwork } from "./network-provider";

type LogRow = {
  id: string;
  created_at: string;
  ok: boolean;
  error_reason: string | null;
  asset_symbol: string | null;
  payer: string | null;
  pay_to: string | null;
  amount: string | null;
  resource: string | null;
  tx_hash: string | null;
  gas_cost_wei: string | null;
  latency_ms: number | null;
  txUrl: string | null;
};

const short = (address: string | null) =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";

const relative = (iso: string) => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
};

// Allowlisted assets on both networks use 6 decimals through their ERC-20
// interface; `asset_symbol` disambiguates which token.
const amount = (base: string | null) =>
  base ? Number(formatUnits(BigInt(base), 6)).toFixed(2) : "—";

// Gas is recorded in native (18-decimal) units, which on Arc is USDC — the same
// unit as the amount above, just a different interface onto it.
const gas = (wei: string | null) =>
  wei ? `${Number(formatEther(BigInt(wei))).toFixed(6)} USDC` : "—";

export function PaymentLog() {
  const { key, net } = useNetwork();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [filter, setFilter] = useState("");
  const [applied, setApplied] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ network: key, limit: "100" });
    // One box for both sides of a payment: `address` matches either role, so the
    // reader does not need to know whether what they have is the payer or the merchant.
    if (applied) params.set("address", applied);

    try {
      const response = await fetch(`/api/logs?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { rows: LogRow[] };
      setRows(body.rows);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [key, applied]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(filter.trim());
          }}
          className="flex items-center gap-2"
        >
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by payer or merchant address"
            className="field w-72"
          />
          <button
            type="submit"
            className="btn btn-ghost"
          >
            Filter
          </button>
          {applied && (
            <button
              type="button"
              onClick={() => {
                setFilter("");
                setApplied("");
              }}
              className="text-xs text-chalk-dim hover:text-chalk"
            >
              Clear
            </button>
          )}
        </form>

      </div>

      <div className="glass mt-4 overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-ink-line font-mono text-[11px] tracking-wide text-chalk-dim uppercase">
            <tr>
              <th className="px-3 py-2.5 font-normal">When</th>
              <th className="px-3 py-2.5 font-normal">Payer</th>
              <th className="px-3 py-2.5 font-normal">Merchant</th>
              <th className="px-3 py-2.5 text-right font-normal">Amount</th>
              <th className="px-3 py-2.5 text-right font-normal">Gas sponsored</th>
              <th className="px-3 py-2.5 font-normal">Result</th>
            </tr>
          </thead>
          <tbody>
            {/* First load cascades in; each new settlement slides in at the top as it lands. */}
            <AnimatePresence initial={true}>
            {rows.map((row, index) => (
              <motion.tr
                key={row.id}
                layout="position"
                initial={{ opacity: 0, y: -8, backgroundColor: "rgba(255,255,255,0.06)" }}
                animate={{ opacity: 1, y: 0, backgroundColor: "rgba(255,255,255,0)" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, ease: EASE, delay: Math.min(index * 0.03, 0.45), backgroundColor: { duration: 1.6 } }}
                whileHover={{ backgroundColor: "rgba(255,255,255,0.035)" }}
                className="border-t border-ink-line align-top"
              >
                <td className="px-3 py-2.5 whitespace-nowrap text-chalk-dim" title={row.created_at}>
                  {relative(row.created_at)}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs" title={row.payer ?? undefined}>
                  {short(row.payer)}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs" title={row.pay_to ?? undefined}>
                  {short(row.pay_to)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap">
                  {amount(row.amount)} {row.asset_symbol ?? ""}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap text-chalk-dim">
                  {gas(row.gas_cost_wei)}
                </td>
                <td className="px-3 py-2.5">
                  {row.ok ? (
                    row.txUrl ? (
                      <a
                        href={row.txUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-xs text-mainnet hover:underline"
                      >
                        {short(row.tx_hash)} ↗
                      </a>
                    ) : (
                      <span className="font-mono text-xs text-mainnet">settled</span>
                    )
                  ) : (
                    <span className="font-mono text-xs text-danger" title={row.error_reason ?? undefined}>
                      {row.error_reason ?? "failed"}
                    </span>
                  )}
                </td>
              </motion.tr>
            ))}
            </AnimatePresence>

            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-chalk-dim">
                  {state === "loading" && "Loading…"}
                  {state === "error" && "Could not read the payment log."}
                  {state === "ready" &&
                    (applied
                      ? "No payments for that address on this network."
                      : `No payments on ${net.name} yet.`)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-chalk-dim">
        Showing the latest {rows.length} entries on {net.name}. Refreshes every 10s. Signatures and
        authorization nonces are never stored.
      </p>
    </div>
  );
}
