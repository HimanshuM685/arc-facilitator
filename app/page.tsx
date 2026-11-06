import Link from "next/link";
import { HeroVideo } from "@/components/hero-video";
import { HomeStats } from "@/components/home-stats";

export default function HomePage() {
  return (
    <>
      <HeroVideo />

      <div className="home">
        <main className="hero" id="top">
          <div className="hero-copy">
            <span className="badge appear appear--pop [--d:0.22s]">
              <svg className="badge-star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
              </svg>
              x402 Facilitator for Arc
            </span>

            <h1>
              <span className="headline-line">
                <span className="appear appear--mask [--d:0.42s]">
                  Accept <em>gasless USDC</em> on your
                </span>
              </span>
              <span className="headline-line">
                <span className="appear appear--mask [--d:0.62s]">APIs in minutes.</span>
              </span>
            </h1>

            <p className="lede appear appear--soft [--d:0.82s]">
              Your customers sign once and never pay gas — not even on Arc, where gas is USDC. We settle the
              payment on-chain out of our own balance, and their USDC goes straight to you. Standard x402
              middleware, one URL.
            </p>

            <div className="hero-actions">
              <Link href="/docs/quickstart-merchant" className="btn-text btn-text--strong appear appear--btn [--d:0.96s]">
                Start building
                <svg className="btn-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
              <span className="hero-actions-sep appear appear--btn [--d:1.02s]" aria-hidden="true" />
              <Link href="/test" className="btn-text appear appear--side [--d:1.10s]">
                Try a payment
                <svg className="btn-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </Link>
            </div>
          </div>
        </main>

        <HomeStats />
      </div>
    </>
  );
}
