"use client";

import { useId } from "react";
import { LayoutGroup, motion } from "motion/react";
import { NETWORK_KEYS } from "@/lib/networks";
import { useNetwork } from "./network-provider";

/** Segmented mainnet/testnet control in the liquid-metal style. The dot colour marks the network. */
export function NetworkSwitch() {
  const { key, setNetwork } = useNetwork();
  // The switch renders twice (header and phone menu); scope each underline.
  const group = useId();

  return (
    <LayoutGroup id={group}>
    <div
      role="radiogroup"
      aria-label="Network"
      className="net-switch flex h-[var(--btn-h)] items-center gap-1"
    >
      {NETWORK_KEYS.map((candidate) => {
        const active = candidate === key;
        const dot = candidate === "mainnet" ? "bg-mainnet" : "bg-testnet";
        return (
          <button
            key={candidate}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setNetwork(candidate)}
            className={[
              "net-switch-option relative flex h-full cursor-pointer items-center gap-1.5 px-2 text-[13px] tracking-[-0.01em]",
              active ? "is-active" : "",
            ].join(" ")}
          >
            <span className={`size-1.5 rounded-full ${dot} ${active ? "" : "opacity-50"}`} />
            {candidate === "mainnet" ? "Mainnet" : "Testnet"}
            {active && (
              <motion.span
                layoutId="net-underline"
                aria-hidden="true"
                className="absolute right-2 bottom-1.5 left-2 h-px rounded-full bg-current opacity-60"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
          </button>
        );
      })}
    </div>
    </LayoutGroup>
  );
}

/**
 * Standing reminder that the selected network moves real funds. Shown rather than
 * relying on the reader noticing a toggle label — a mainnet code sample copied by
 * accident is the most expensive mistake this site can cause.
 */
export function MainnetBanner() {
  const { isMainnet } = useNetwork();
  if (!isMainnet) return null;

  return (
    <div className="relative z-[60] border-b border-white/10 bg-[#111] px-4 py-2 text-center text-xs text-[#f2f2f2]">
      Mainnet selected — snippets on this page move real USDC on Arc mainnet.
    </div>
  );
}
