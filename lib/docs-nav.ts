/**
 * The docs table of contents. Also the route manifest: `generateStaticParams`
 * builds exactly these pages, so a file in content/docs that nobody linked here
 * is not reachable — one list to edit instead of two that drift.
 */

export type DocEntry = { slug: string; title: string; summary: string };
export type DocSection = { heading: string; entries: DocEntry[] };

export const DOCS: DocSection[] = [
  {
    heading: "Start here",
    entries: [
      {
        slug: "index",
        title: "Overview",
        summary: "What this facilitator does and when you want one.",
      },
      {
        slug: "what-is-x402",
        title: "What is x402",
        summary: "The 402 handshake, the four parties, and what gasless really means.",
      },
      {
        slug: "choose-a-network",
        title: "Choose a network",
        summary: "Arc mainnet or Arc Testnet — what differs and how the toggle works.",
      },
    ],
  },
  {
    heading: "Build",
    entries: [
      {
        slug: "quickstart-merchant",
        title: "Charge for an endpoint",
        summary: "Put a price on a route with Express, Next or Hono.",
      },
      {
        slug: "quickstart-agent",
        title: "Pay for an endpoint",
        summary: "An agent that pays with USDC and never pays gas.",
      },
      {
        slug: "bazaar",
        title: "List your API in the Bazaar",
        summary: "Get discovered by agents: describe your endpoints, and we verify they pay you.",
      },
      {
        slug: "quickstart-testnet",
        title: "Testnet setup",
        summary: "Get testnet USDC from the faucet, run the whole loop.",
      },
      {
        slug: "quickstart-mainnet",
        title: "Mainnet setup",
        summary: "Real money behind a switch: what to check before you point at it.",
      },
    ],
  },
  {
    heading: "Reference",
    entries: [
      {
        slug: "how-it-works",
        title: "How it works",
        summary: "EIP-3009 end to end, and exactly what we can and cannot do.",
      },
      {
        slug: "api-reference",
        title: "API reference",
        summary: "/verify, /settle, /supported, /assets, /health.",
      },
      {
        slug: "supported-assets",
        title: "Supported assets",
        summary: "USDC on both networks, its EIP-712 domain, and the two decimal views.",
      },
      {
        slug: "network-reference",
        title: "Network reference",
        summary: "Chain ids, RPCs, explorers, contracts, and Arc's EVM differences.",
      },
      {
        slug: "limits",
        title: "Limits",
        summary: "Rate limits, the gas wallet, and what a 429 or 503 means.",
      },
      {
        slug: "self-host",
        title: "Self-host",
        summary: "Run your own: environment, database, deployment.",
      },
    ],
  },
];

export const DOC_ENTRIES: DocEntry[] = DOCS.flatMap((section) => section.entries);

export const findDoc = (slug: string): DocEntry | undefined =>
  DOC_ENTRIES.find((entry) => entry.slug === slug);

/** Previous/next pair in reading order, for the footer pager. */
export function docNeighbours(slug: string): { prev?: DocEntry; next?: DocEntry } {
  const index = DOC_ENTRIES.findIndex((entry) => entry.slug === slug);
  if (index < 0) return {};
  return { prev: DOC_ENTRIES[index - 1], next: DOC_ENTRIES[index + 1] };
}

export const docHref = (slug: string): string => (slug === "index" ? "/docs" : `/docs/${slug}`);
