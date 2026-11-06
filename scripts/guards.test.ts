/**
 * Checks on the refusal logic — the code that decides whether we spend money.
 *
 * Runs without a database or RPC: every case here is decided before `preflight`
 * reaches the signer balance read, which is itself part of what is being asserted
 * (cheap checks first, so a rejected request costs nothing).
 *
 *   pnpm test
 */

import assert from "node:assert/strict";

// Set before importing lib/guards — its `config` is read from env at module load.
process.env.MIN_AMOUNT_BASE_UNITS = "10000";
process.env.MAINNET_ENABLED = "false";
process.env.RATE_LIMIT_IP_PER_MIN = "3";
process.env.RATE_LIMIT_PAYER_PER_MIN = "1000";
process.env.RATE_LIMIT_PAYTO_PER_MIN = "1000";
process.env.RATE_LIMIT_GLOBAL_PER_MIN = "1000";

const { preflight, resetRateLimits, clientIp } = await import("../lib/guards");
const { NETWORKS, findAsset } = await import("../lib/networks");
const { safeErrorMessage } = await import("../lib/redact");

const USDC_TESTNET = NETWORKS.testnet.assets.find((a) => a.symbol === "USDC")!;
const USDC_MAINNET = NETWORKS.mainnet.assets.find((a) => a.symbol === "USDC")!;
const MERCHANT = "0x1111111111111111111111111111111111111111";

const base = {
  net: "testnet" as const,
  phase: "verify" as const,
  ip: "203.0.113.1",
  scheme: "exact",
  network: NETWORKS.testnet.caip2,
  asset: USDC_TESTNET.address,
  amount: "10000",
  payTo: MERCHANT,
};

let passed = 0;
async function check(name: string, run: () => Promise<void> | void) {
  await run();
  passed += 1;
  console.log(`  ok  ${name}`);
}

resetRateLimits();

await check("a well-formed testnet payment passes", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.1" });
  assert.equal(result.kind, "ok");
  assert.equal(result.kind === "ok" && result.asset.symbol, "USDC");
});

await check("mixed-case asset addresses still match", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.2", asset: USDC_TESTNET.address.toUpperCase() });
  assert.equal(result.kind, "ok");
});

await check("an unknown asset is rejected", async () => {
  const result = await preflight({
    ...base,
    ip: "198.51.100.3",
    asset: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  });
  assert.equal(result.kind, "reject");
  assert.equal(result.kind === "reject" && result.reason, "unsupported_asset");
});

await check("USDC is the only stablecoin served, on both networks", () => {
  assert.deepEqual(NETWORKS.testnet.assets.map((a) => a.symbol), ["USDC"]);
  assert.deepEqual(NETWORKS.mainnet.assets.map((a) => a.symbol), ["USDC"]);
});

await check("mainnet USDC is allowlisted and passes verify", async () => {
  const result = await preflight({
    ...base,
    net: "mainnet",
    ip: "198.51.100.40",
    network: NETWORKS.mainnet.caip2,
    asset: USDC_MAINNET.address,
  });
  assert.equal(result.kind, "ok");
  assert.equal(result.kind === "ok" && result.asset.symbol, "USDC");
});

// On Arc both networks share USDC's address — it is a predeploy at 0x3600…, not
// a per-network deployment — so the address alone cannot separate them. What
// stops a testnet authorization being replayed as a mainnet payment is the CAIP-2
// comparison, which runs before the asset lookup. That makes this case more
// important here than on a chain with distinct token addresses, not less.
await check("the same asset address on the wrong network is rejected", async () => {
  assert.equal(
    USDC_TESTNET.address.toLowerCase(),
    USDC_MAINNET.address.toLowerCase(),
    "precondition: Arc USDC shares one address across networks",
  );
  const result = await preflight({
    ...base,
    net: "mainnet",
    ip: "198.51.100.41",
    // Mainnet route, but the payload still claims the testnet network.
    network: NETWORKS.testnet.caip2,
    asset: USDC_MAINNET.address,
  });
  assert.equal(result.kind, "reject");
  assert.equal(result.kind === "reject" && result.reason, "unsupported_network");
});

await check("an address that is not allowlisted is rejected on mainnet too", async () => {
  const result = await preflight({
    ...base,
    net: "mainnet",
    ip: "198.51.100.42",
    network: NETWORKS.mainnet.caip2,
    asset: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  });
  assert.equal(result.kind === "reject" && result.reason, "unsupported_asset");
  assert.equal(findAsset("mainnet", "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"), undefined);
});

await check("a mismatched network identifier is rejected", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.5", network: "eip155:8453" });
  assert.equal(result.kind, "reject");
  assert.equal(result.kind === "reject" && result.reason, "unsupported_network");
});

await check("a scheme other than exact is rejected", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.6", scheme: "upto" });
  assert.equal(result.kind, "reject");
  assert.equal(result.kind === "reject" && result.reason, "unsupported_scheme");
});

await check("dust below the floor is rejected", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.7", amount: "9999" });
  assert.equal(result.kind, "reject");
  assert.equal(result.kind === "reject" && result.reason, "amount_below_minimum");
});

await check("exactly the floor is accepted", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.8", amount: "10000" });
  assert.equal(result.kind, "ok");
});

await check("a non-integer amount is rejected", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.9", amount: "0.01" });
  assert.equal(result.kind, "reject");
  assert.equal(result.kind === "reject" && result.reason, "invalid_amount");
});

await check("the per-IP rate limit trips and sets Retry-After", async () => {
  resetRateLimits();
  const ip = "198.51.100.10";
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await preflight({ ...base, ip })).kind, "ok", `request ${i + 1} should pass`);
  }
  const limited = await preflight({ ...base, ip });
  assert.equal(limited.kind, "http");
  assert.equal(limited.kind === "http" && limited.status, 429);
  assert.equal(limited.kind === "http" && limited.reason, "rate_limited");
  assert.ok(limited.kind === "http" && (limited.retryAfter ?? 0) > 0);
});

await check("rate limits are per IP, not global", async () => {
  const result = await preflight({ ...base, ip: "198.51.100.11" });
  assert.equal(result.kind, "ok");
});

// No FACILITATOR_PRIVATE_KEY in this run, so the signer cannot be read. Settle
// must refuse with a clear 503 rather than throw.
await check("settle refuses when the signer is unavailable", async () => {
  resetRateLimits();
  const result = await preflight({ ...base, phase: "settle", ip: "198.51.100.20" });
  assert.equal(result.kind, "http");
  assert.equal(result.kind === "http" && result.status, 503);
  assert.equal(result.kind === "http" && result.reason, "signer_unavailable");
});

await check("client IP comes from the proxy headers", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "70.0.0.1, 10.0.0.1" })), "70.0.0.1");
  assert.equal(clientIp(new Headers({ "x-real-ip": "70.0.0.2" })), "70.0.0.2");
  assert.equal(clientIp(new Headers()), "unknown");
});

// A caller can send x-forwarded-for themselves; the platform-written headers
// cannot be forged past the edge. Reading the spoofable one first would let
// anyone mint a fresh rate-limit bucket per request.
await check("a platform-written IP header beats a caller-supplied one", () => {
  const spoofed = new Headers({
    "x-forwarded-for": "1.2.3.4",
    "x-vercel-forwarded-for": "70.0.0.3",
  });
  assert.equal(clientIp(spoofed), "70.0.0.3");

  assert.equal(
    clientIp(new Headers({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "70.0.0.4" })),
    "70.0.0.4",
  );
  assert.equal(
    clientIp(new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "70.0.0.5" })),
    "70.0.0.5",
  );
});

// Settlement failures land in the payment log, which /api/logs serves publicly.
// A raw viem error carries the RPC URL and the decoded call arguments — for
// transferWithAuthorization that includes the payer's signature.
await check("error text is redacted before it can be stored or published", () => {
  const viemish = new Error(
    "HTTP request failed.\n\nURL: https://rpc.example.io/v1/SECRET_KEY\n" +
      "Request body: {\"method\":\"eth_sendRawTransaction\",\"params\":[\"0x02f8b18207" +
      "52808504a817c800850c4b2001f6830186a094cedfb561\"]}\n" +
      "args: (0x2222222222222222222222222222222222222222, 10000, " +
      "0x1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b" +
      "1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b)",
  );

  const safe = safeErrorMessage(viemish);
  assert.ok(!safe.includes("SECRET_KEY"), "RPC URL survived redaction");
  assert.ok(!safe.includes("rpc.example.io"), "RPC host survived redaction");
  assert.ok(!/0x[0-9a-fA-F]{40,}/.test(safe), "a long hex blob survived redaction");
  assert.ok(safe.includes("<url>") && safe.includes("<hex>"), "redaction markers missing");
  assert.ok(safe.length <= 300, "redacted message not length-capped");
  assert.ok(!safe.includes("\n"), "newlines not collapsed");

  // Short, non-sensitive text should survive intact and readable.
  assert.equal(safeErrorMessage(new Error("insufficient funds")), "insufficient funds");
  assert.equal(safeErrorMessage("plain string"), "plain string");
});

// Timestamps alone are not unique; the cursor carries the id to break ties.
await check("log cursor splits timestamp and id, and accepts a bare timestamp", async () => {
  const { parseCursor } = await import("../lib/db");
  assert.deepEqual(parseCursor("2026-11-06 12:00:00.123456+00_42"), {
    ts: "2026-11-06 12:00:00.123456+00",
    id: "42",
  });
  assert.deepEqual(parseCursor("2026-11-06T12:00:00.123Z"), { ts: "2026-11-06T12:00:00.123Z", id: null });
  assert.deepEqual(parseCursor("x_1; drop table"), { ts: "x_1; drop table", id: null });
});

// ── Bazaar ────────────────────────────────────────────────────────────────
// We fetch URLs that strangers hand us, so the refusal rules are tested hard.
const bazaar = await import("../lib/bazaar");

await check("bazaar refuses private, loopback and metadata addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(bazaar.isPublicIp(ip), false, `${ip} should be private`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(bazaar.isPublicIp(ip), true, `${ip} should be public`);
  }
});

await check("bazaar only calls public https endpoints", async () => {
  for (const url of ["http://example.com/x402", "https://localhost/x402", "https://127.0.0.1/x402", "https://user:pw@example.com/", "not a url"]) {
    assert.ok("error" in (await bazaar.safeTarget(url)), `${url} should be refused`);
  }
});

await check("bazaar lists an endpoint only when its 402 pays the claimed address", () => {
  const MERCHANT_B = "0x2222222222222222222222222222222222222222";
  const paymentRequired = {
    x402Version: 2,
    resource: { url: "https://acme.example/x402/top-up" },
    accepts: [{ scheme: "exact", network: NETWORKS.testnet.caip2, asset: USDC_TESTNET.address, amount: "10000", payTo: MERCHANT, maxTimeoutSeconds: 60, extra: {} }],
  } as unknown as Parameters<typeof bazaar.matchPayTo>[0];

  assert.equal(bazaar.matchPayTo(paymentRequired, MERCHANT.toUpperCase().replace("0X", "0x")).status, "verified");
  assert.equal(bazaar.matchPayTo(paymentRequired, MERCHANT_B).status, "mismatch");

  // Right address, but on a chain we do not serve: not ours to list.
  const base = { ...paymentRequired, accepts: [{ ...paymentRequired.accepts[0]!, network: "eip155:8453" }] };
  assert.equal(bazaar.matchPayTo(base as typeof paymentRequired, MERCHANT).status, "mismatch");
});

await check("bazaar registration input is validated", () => {
  assert.ok("error" in bazaar.parseRegistration({ payTo: "nope", endpoints: ["https://a.example/x"] }));
  assert.ok("error" in bazaar.parseRegistration({ payTo: MERCHANT, endpoints: [] }));
  assert.ok("error" in bazaar.parseRegistration({ payTo: MERCHANT, endpoints: Array(26).fill("https://a.example/x") }));
  const ok = bazaar.parseRegistration({
    payTo: MERCHANT,
    name: "Acme",
    website: "https://acme.example/about",
    endpoints: ["https://acme.example/x402/top-up", { url: "https://acme.example/x402/report", method: "post" }],
  });
  assert.ok("input" in ok);
  assert.equal(ok.input.website, "https://acme.example");
  assert.equal(ok.input.payTo, MERCHANT.toLowerCase());
  assert.deepEqual(ok.input.endpoints[1], { url: "https://acme.example/x402/report", method: "POST" });
});

console.log(`\n${passed} checks passed.`);
