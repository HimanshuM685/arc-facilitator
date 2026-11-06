import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { TestPayment } from "@/components/test-payment";

export const metadata: Metadata = {
  title: "Test a payment",
  description: "Sign an x402 payment in your browser wallet and run it through this facilitator's /verify and /settle.",
};

export default function TestPage() {
  return (
    <main className="relative z-[1] mx-auto max-w-6xl px-5 py-12">
      <PageHero
        badge="Live on Arc Testnet"
        title={
          <>
            Test a <em className="serif-em">real payment</em> in your browser.
          </>
        }
        lede={
          <>
            Your wallet signs a USDC authorization. It never sends a transaction. We run it through{" "}
            <code className="font-mono text-[0.9em] text-white">/verify</code> and{" "}
            <code className="font-mono text-[0.9em] text-white">/settle</code>, submit it on-chain and pay the gas.
            Gas on Arc is USDC too, so the proof is not a zero balance — it is that your balance moves by
            exactly the amount you signed for, and not one wei more.
          </>
        }
      />
      <TestPayment />
    </main>
  );
}
