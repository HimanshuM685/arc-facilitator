import type { Metadata } from "next";
import { MerchantPage } from "@/components/merchant-page";

type Params = { payTo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { payTo } = await params;
  return { title: `Merchant ${payTo.slice(0, 6)}…${payTo.slice(-4)}`, description: "Verified x402 endpoints for this merchant." };
}

export default async function MerchantRoute({ params }: { params: Promise<Params> }) {
  const { payTo } = await params;
  return (
    <main className="relative z-[1] mx-auto max-w-5xl px-5 py-12">
      <MerchantPage payTo={payTo.toLowerCase()} />
    </main>
  );
}
