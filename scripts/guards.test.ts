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
process.env.RATE_LIMIT_PAYER_PER_MIN = "2";
process.env.RATE_LIMIT_PAYTO_PER_MIN = "1000";
process.env.RATE_LIMIT_GLOBAL_PER_MIN = "1000";

const { preflight, resetRateLimits, clientIp, readConfig } = await import("../lib/guards");
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
// The per-payer limit existed in the config and in the docs but nothing ever
// passed `payer`, so it never fired. The address comes from the signed payload,
// not a header, which is why it is the one bucket a caller cannot rotate.
await check("the per-payer rate limit trips across different IPs", async () => {
  resetRateLimits();
  const payer = "0x3333333333333333333333333333333333333333";
  for (let i = 0; i < 2; i += 1) {
    const result = await preflight({ ...base, ip: `198.51.100.6${i}`, payer });
    assert.equal(result.kind, "ok", `request ${i + 1} should pass`);
  }
  const limited = await preflight({ ...base, ip: "198.51.100.69", payer });
  assert.equal(limited.kind, "http");
  assert.equal(limited.kind === "http" && limited.reason, "rate_limited");

  // A different payer on a fresh IP is unaffected.
  const other = await preflight({ ...base, ip: "198.51.100.70", payer: "0x4444444444444444444444444444444444444444" });
  assert.equal(other.kind, "ok");
});

await check("a payload with no usable payer is not bucketed under a junk key", async () => {
  const { payerOf } = await import("../lib/facilitator-http");
  assert.equal(payerOf({ payload: { authorization: { from: MERCHANT } } } as never), MERCHANT);
  assert.equal(payerOf({ payload: { authorization: { from: "not-an-address" } } } as never), undefined);
  assert.equal(payerOf({} as never), undefined);
});

// A blank line in a .env — RATE_LIMIT_IP_PER_MIN= — used to read as Number(""),
// which is 0, which `hit()` treats as "no limit". The dust floor went the same
// way via BigInt(""), and MIN_SIGNER_BALANCE_USDC= threw inside parseEther at
// import time, taking /verify, /settle and /health down with it.
await check("blank or unusable environment values fall back instead of disabling a guard", () => {
  const blank = readConfig({
    RATE_LIMIT_IP_PER_MIN: "",
    RATE_LIMIT_GLOBAL_PER_MIN: "   ",
    MIN_AMOUNT_BASE_UNITS: "",
    MAX_SETTLE_GAS: "",
    MIN_SIGNER_BALANCE_USDC: "",
  });
  assert.equal(blank.rateLimit.ip, 120);
  assert.equal(blank.rateLimit.global, 1200);
  assert.equal(blank.minAmountBaseUnits, 10_000n);
  assert.equal(blank.maxSettleGas, 300_000n);
  assert.ok(blank.minSignerBalanceWei > 0n);

  const junk = readConfig({
    RATE_LIMIT_IP_PER_MIN: "abc",
    RATE_LIMIT_PAYER_PER_MIN: "-5",
    MIN_AMOUNT_BASE_UNITS: "0.01",
    MIN_SIGNER_BALANCE_USDC: "not-a-number",
  });
  assert.equal(junk.rateLimit.ip, 120);
  assert.equal(junk.rateLimit.payer, 30, "a negative limit must not read as off");
  assert.equal(junk.minAmountBaseUnits, 10_000n);
  assert.equal(junk.minSignerBalanceWei, readConfig({}).minSignerBalanceWei);

  // An explicit 0 is a deliberate "off" and is still honoured.
  assert.equal(readConfig({ RATE_LIMIT_IP_PER_MIN: "0" }).rateLimit.ip, 0);
});

// With the floor configurable down to 0, nothing else was left to reject a
// zero or negative amount.
await check("a non-positive amount is rejected whatever the floor is set to", async () => {
  resetRateLimits();
  for (const amount of ["0", "-10000"]) {
    const result = await preflight({ ...base, ip: "198.51.100.80", amount });
    assert.equal(result.kind, "reject", `${amount} should be rejected`);
    assert.equal(result.kind === "reject" && result.reason, "invalid_amount");
  }
});

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

// `new URL()` normalises the host, so a dotted-quad regex never saw the hex form
// of an IPv4-mapped address. ::ffff:7f00:1 is 127.0.0.1 and ::ffff:a9fe:a9fe is
// the cloud metadata service.
await check("bazaar refuses every spelling of an IPv4-mapped or tunnelled address", () => {
  for (const ip of [
    "::ffff:7f00:1",
    "::FFFF:A9FE:A9FE",
    "::ffff:0a00:0001",
    "::ffff:ac10:1",
    "64:ff9b::7f00:1",
    "2002:7f00:1::",
    "2001:0:1234::1",
    "::",
    "not-an-ip",
  ]) {
    assert.equal(bazaar.isPublicIp(ip), false, `${ip} should be refused`);
  }
  assert.equal(bazaar.isPublicIp("2a00:1450:4001:800::200e"), true);
});

await check("bazaar refuses a route template, which could never answer a 402", async () => {
  assert.equal(bazaar.isTemplatedUrl(new URL("https://acme.example/items/{id}")), true);
  assert.equal(bazaar.isTemplatedUrl(new URL("https://acme.example/items/%7Bid%7D")), true);
  assert.equal(bazaar.isTemplatedUrl(new URL("https://acme.example/items/42")), false);
  assert.ok("error" in (await bazaar.safeTarget("https://acme.example/items/{id}")));
});

// Registration is unauthenticated, so the verbs we are willing to aim at a
// stranger's URL are limited to the two a paid x402 route actually uses.
await check("bazaar will not be asked to send a mutating request", () => {
  for (const method of ["DELETE", "PUT", "PATCH"]) {
    assert.ok(
      "error" in bazaar.parseRegistration({ payTo: MERCHANT, endpoints: [{ url: "https://a.example/x", method }] }),
      `${method} should be refused`,
    );
  }
  assert.ok("input" in bazaar.parseRegistration({ payTo: MERCHANT, endpoints: [{ url: "https://a.example/x", method: "post" }] }));
});

// The hijack this closes: name a competitor's endpoint, claim your own address,
// and their verified listing is re-pointed and reset to pending.
await check("a verified listing cannot be claimed by another pay-to", () => {
  const MERCHANT_B = "0x2222222222222222222222222222222222222222";
  const verified = { pay_to: MERCHANT, status: "verified" as const };
  assert.equal(bazaar.mayClaim(verified, MERCHANT_B), false);
  assert.equal(bazaar.mayClaim(verified, MERCHANT), true, "the owner may still refresh its own row");
  assert.equal(bazaar.mayClaim(undefined, MERCHANT_B), true, "a new endpoint is anyone's to register");
  for (const status of ["pending", "mismatch", "unreachable"] as const) {
    assert.equal(bazaar.mayClaim({ pay_to: MERCHANT, status }, MERCHANT_B), true, `${status} is not owned`);
  }
});

// One timeout used to delist a live merchant, and the daily sweep only looked at
// verified rows, so it was never retried.
await check("a transient failure is retried; a verdict is not", () => {
  for (const detail of ["timed out after 5s", "request failed", "expected HTTP 402, got 503"]) {
    assert.equal(bazaar.isTransientFailure({ status: "unreachable", detail }), true, detail);
  }
  for (const detail of ["expected HTTP 402, got 404", "402 has no PAYMENT-REQUIRED header", "only https:// endpoints can be listed"]) {
    assert.equal(bazaar.isTransientFailure({ status: "unreachable", detail }), false, detail);
  }
  assert.equal(bazaar.isTransientFailure({ status: "mismatch", detail: "timed out after 5s" }), false);
});

console.log(`\n${passed} checks passed.`);
