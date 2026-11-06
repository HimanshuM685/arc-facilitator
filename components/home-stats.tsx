"use client";

import { useEffect, useState } from "react";
import { useNetwork } from "./network-provider";

type Totals = { settled: number; gasSponsoredUsdc: string; uniquePayers: number; volume: string };

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const count = (n: number) => (n < 10_000 ? n.toLocaleString("en-US") : compact.format(n));
const usdc = (v: string) => {
  const n = Number(v);
  return n < 10_000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : compact.format(n);
};

/**
 * The three stats along the bottom of the home page, live from the settlement
 * log of the selected network. Shows "—" until loaded or if the log is down —
 * never a made-up number.
 */
export function HomeStats() {
  const { key } = useNetwork();
  const [totals, setTotals] = useState<Totals | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/stats?range=all", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { networks: { network: string; current: Totals }[] };
        if (!cancelled) setTotals(body.networks.find((n) => n.network === key)?.current ?? null);
      } catch {
        if (!cancelled) setTotals(null);
      }
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);

  const dash = "—";

  return (
    <footer className="stats" aria-label="Live settlement stats">
      <div className="stat appear appear--stat [--d:1.12s]">
        <svg className="stat-icon" viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id="pill-a" x1="3" y1="2" x2="14" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.38" />
              <stop offset="1" stopColor="#3a3a3a" stopOpacity="0.62" />
            </linearGradient>
            <linearGradient id="pill-b" x1="3" y1="2" x2="14" y2="22" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#3a3a3a" stopOpacity="0.38" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0.62" />
            </linearGradient>
          </defs>
          <rect x="3.4" y="2.6" width="7.2" height="18.8" rx="3.6" fill="url(#pill-a)" />
          <rect x="13.4" y="2.6" width="7.2" height="18.8" rx="3.6" fill="url(#pill-b)" />
          <rect x="9.2" y="10.9" width="5.6" height="2.2" rx="1.1" fill="#4a4a4a" />
        </svg>
        <span>
          {totals ? count(totals.settled) : dash} payments settled · {totals ? usdc(totals.volume) : dash} USDC
        </span>
      </div>

      <div className="stat appear appear--stat [--d:1.28s]">
        <svg className="stat-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="2.4" y="2.4" width="19.2" height="19.2" rx="6.2" fill="#ffffff" />
          <path d="M12 7.1v7.4" stroke="#111" strokeWidth="1.85" strokeLinecap="round" fill="none" />
          <path
            d="M8.15 12.35L12 16.2l3.85-3.85"
            stroke="#111"
            strokeWidth="1.85"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span>{totals ? Number(totals.gasSponsoredUsdc).toFixed(4) : dash} USDC of gas paid for payers</span>
      </div>

      <div className="stat appear appear--stat [--d:1.44s]">
        <svg className="stat-icon-wide" viewBox="0 0 40 22" aria-hidden="true">
          <circle cx="10.2" cy="11" r="9.2" fill="#2b2b2b" />
          <path d="M6.3 10.2 L6.9 6.4 L9.2 8.9 Z" fill="#f4f4f4" />
          <path d="M14.1 10.2 L13.5 6.4 L11.2 8.9 Z" fill="#f4f4f4" />
          <ellipse cx="10.2" cy="12.1" rx="4.15" ry="3.7" fill="#f4f4f4" />
          <circle cx="8.6" cy="11.7" r="0.7" fill="#1a1a1a" />
          <circle cx="11.8" cy="11.7" r="0.7" fill="#1a1a1a" />
          <circle cx="20.2" cy="11" r="9.2" fill="#ffffff" stroke="#000" strokeWidth="0.8" />
          <circle cx="17.4" cy="9.6" r="1.7" fill="#111" />
          <circle cx="23" cy="9.6" r="1.7" fill="#111" />
          <ellipse cx="20.2" cy="12.4" rx="0.95" ry="0.7" fill="#111" />
          <path d="M17.5 14.4 Q20.2 16.9 22.9 14.4" stroke="#111" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          <circle cx="30.2" cy="11" r="9.2" fill="#f26b1d" stroke="#000" strokeWidth="0.8" />
          <text
            x="30.2"
            y="15.1"
            fontFamily="Inter, system-ui, sans-serif"
            fontWeight="700"
            fontSize="12.5"
            textAnchor="middle"
            fill="#ffffff"
          >
            e
          </text>
        </svg>
        <span>{totals ? count(totals.uniquePayers) : dash} unique payers, none of whom paid gas</span>
      </div>
    </footer>
  );
}
