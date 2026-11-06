import type { Metadata } from "next";
import Link from "next/link";
import { BazaarGrid } from "@/components/bazaar-grid";
import { Reveal } from "@/components/motion";
import { PageHero } from "@/components/page-hero";

export const metadata: Metadata = {
  title: "Bazaar",
  description: "Verified x402 merchants and the endpoints they sell on Arc, discoverable by agents through /discovery/resources.",
};

export default function BazaarPage() {
  return (
    <main className="relative z-[1] mx-auto max-w-6xl px-5 py-12">
      <PageHero
        badge="x402 Bazaar"
        title={
          <>
            APIs you can pay for, <em className="serif-em">verified.</em>
          </>
        }
        lede={
          <>
            Every merchant here has x402 endpoints whose live 402 pays the address shown. Agents can read the same
            catalog from <code className="font-mono text-[0.9em] text-white">/discovery/resources</code>.{" "}
            <Link href="/docs/bazaar" className="underline underline-offset-4 hover:text-white">
              List your API
            </Link>
            .
          </>
        }
      />
      <Reveal delay={0.25}>
        <BazaarGrid />
      </Reveal>
    </main>
  );
}
