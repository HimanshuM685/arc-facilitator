import Link from "next/link";

/** The brand mark: two pills and two dots, tilted. Shared by header and favicon. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <g transform="rotate(-30 12 12)">
        <circle cx="7.3" cy="3.2" r="1.45" />
        <rect x="5.5" y="4.7" width="3.6" height="14.6" rx="1.8" />
        <rect x="14.9" y="4.7" width="3.6" height="14.6" rx="1.8" />
        <circle cx="16.7" cy="20.8" r="1.45" />
      </g>
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="x402 Facilitator for Arc"
      className={`inline-flex items-center gap-[9px] text-[length:var(--logo)] font-semibold tracking-[-0.03em] text-[var(--top-fg)] transition-colors duration-[1200ms] ${className}`}
    >
      <LogoMark className="size-[var(--logo-mark)] shrink-0" />
      <span>
        x402<span className="font-normal opacity-60">.arc</span>
      </span>
    </Link>
  );
}
