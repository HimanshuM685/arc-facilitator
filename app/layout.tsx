import { Suspense } from "react";
import type { Metadata } from "next";
import { NetworkProvider } from "@/components/network-provider";
import { MotionProvider } from "@/components/motion";
import { MotionSettle } from "@/components/motion-settle";
import { MainnetBanner } from "@/components/network-switch";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { isNetworkKey } from "@/lib/networks";
import "./globals.css";

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cg transform='rotate(-30 12 12)'%3E%3Ccircle cx='7.3' cy='3.2' r='1.45'/%3E%3Crect x='5.5' y='4.7' width='3.6' height='14.6' rx='1.8'/%3E%3Crect x='14.9' y='4.7' width='3.6' height='14.6' rx='1.8'/%3E%3Ccircle cx='16.7' cy='20.8' r='1.45'/%3E%3C/g%3E%3C/svg%3E";

export const metadata: Metadata = {
  title: {
    default: "x402 Facilitator for Arc — Gasless USDC payments",
    template: "%s · x402 Facilitator for Arc",
  },
  description:
    "Gasless x402 payments on Arc. Payers sign an EIP-3009 authorization; we settle it on-chain and pay the USDC gas out of our own balance. Standard x402 middleware, one URL, no custody.",
  icons: { icon: FAVICON },
};

const DEFAULT_NETWORK = isNetworkKey(process.env.NEXT_PUBLIC_DEFAULT_NETWORK)
  ? process.env.NEXT_PUBLIC_DEFAULT_NETWORK
  : "testnet";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Force black before any stylesheet loads, so the page can never flash white. */}
        <style>{`html, body { background: #000000 !important; color: #ffffff; }`}</style>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900&family=Instrument+Serif:ital@1&display=swap"
        />
      </head>
      <body style={{ background: "#000", color: "#fff" }} className="min-h-dvh font-sans">
        <div className="grain" aria-hidden="true" />
        <MotionSettle />
        {/* NetworkProvider reads useSearchParams, so it needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <NetworkProvider defaultNetwork={DEFAULT_NETWORK}>
            <MotionProvider>
              <MainnetBanner />
              <SiteHeader />
              {children}
              <SiteFooter />
            </MotionProvider>
          </NetworkProvider>
        </Suspense>
      </body>
    </html>
  );
}
