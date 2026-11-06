import type { Metadata } from "next";
import { LiveStats } from "@/components/live-stats";
import { Reveal } from "@/components/motion";
import { PageHero } from "@/components/page-hero";
import { PaymentLog } from "@/components/payment-log";

export const metadata: Metadata = {
  title: "Transactions",
  description:
    "Every x402 payment this facilitator has settled on Arc, with explorer links and the USDC gas sponsored for each.",
};

export default function LogsPage() {
  return (
    <main className="relative z-[1] mx-auto max-w-6xl px-5 py-12">
      <PageHero
        badge="Public settlement log"
        title={
          <>
            Every payment, <em className="serif-em">on the record.</em>
          </>
        }
        lede="Each settlement carries an on-chain hash you can check yourself: the payer's USDC goes straight to the merchant, and our signer pays the fee out of its own USDC."
      />
      <Reveal delay={0.25}>
        <LiveStats />
      </Reveal>
      <Reveal delay={0.35} className="mt-12">
        <PaymentLog />
      </Reveal>
    </main>
  );
}
