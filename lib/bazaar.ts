/**
 * The Bazaar: a directory of merchants (pay-to addresses) and their x402
 * endpoints, served in the official @x402/extensions/bazaar discovery shape.
 *
 * An endpoint gets into the catalog two ways:
 *   - a payment for it settles through this facilitator (recordSettle), or
 *   - the merchant's own code registers it (registerMerchant).
 *
 * Either way it is shown only while VERIFIED: we call the URL ourselves and its
 * live 402 response must name that same pay-to on a network we serve. Claims in
 * a payment payload or a registration body are never trusted on their own.
 * Re-verified every 10 settles, or once a day, whichever comes first.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { after } from "next/server";
import { isAddress } from "viem";
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import {
  extractDiscoveryInfo,
  isValidServiceName,
  sanitizeResourceServiceMetadata,
  type DiscoveryResource,
} from "@x402/extensions/bazaar";
import { db, ensureSchema } from "./db";
import { networkByCaip2 } from "./networks";

export type EndpointStatus = "pending" | "verified" | "mismatch" | "unreachable";

const RECHECK_EVERY_SETTLES = 10;
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
export const MAX_REGISTER_ENDPOINTS = 25;
/** Most endpoints returned for one merchant (`GET /api/bazaar/:payTo`, the merchant page). */
export const MAX_MERCHANT_ENDPOINTS = 100;

/** Dev-only escape hatch so a merchant on http://localhost can be tested. Never set in production. */
const ALLOW_PRIVATE = process.env.BAZAAR_ALLOW_PRIVATE_TARGETS === "true";

/* ------------------------------------------------------------------ *
 * Outbound-call safety (we fetch URLs supplied by strangers)
 * ------------------------------------------------------------------ */

/** True for addresses on the public internet; false for loopback, private, link-local, CGNAT, etc. */
export function isPublicIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    return true;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]!);
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower)) return false; // unique local fc00::/7
    if (/^fe[89ab]/.test(lower)) return false; // link-local fe80::/10
    return true;
  }
  return false;
}

/** Parses a merchant-supplied URL and refuses anything we should not call. */
export async function safeTarget(raw: string): Promise<{ url: URL } | { error: string }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { error: "not a valid URL" };
  }
  if (url.username || url.password) return { error: "URL must not carry credentials" };
  if (url.protocol !== "https:" && !(ALLOW_PRIVATE && url.protocol === "http:")) {
    return { error: "only https:// endpoints can be listed" };
  }
  if (ALLOW_PRIVATE) return { url };

  const host = url.hostname.replace(/^\[|\]$/g, "");
  // ponytail: DNS is resolved here and again by fetch, leaving a rebinding window.
  // Pin the resolved IP into the request if this ever needs to be airtight.
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) return { error: "host does not resolve" };
  if (!addresses.every((a) => isPublicIp(a.address))) return { error: "host resolves to a private address" };
  return { url };
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

export type CheckResult = {
  status: Exclude<EndpointStatus, "pending">;
  detail: string;
  paymentRequired?: PaymentRequired;
  network?: string;
};

/** The core rule: does this 402 pay `payTo` on a network we serve? Pure, so it is tested directly. */
export function matchPayTo(paymentRequired: PaymentRequired, payTo: string): CheckResult {
  const wanted = payTo.toLowerCase();
  const accepts = paymentRequired.accepts ?? [];
  const ours = accepts.filter((a) => networkByCaip2(a.network));
  if (ours.length === 0) {
    return { status: "mismatch", detail: "402 offers no network this facilitator serves", paymentRequired };
  }
  const hit = ours.find((a) => a.payTo?.toLowerCase() === wanted);
  if (!hit) {
    return { status: "mismatch", detail: "402 pays a different address than the one claimed", paymentRequired };
  }
  return { status: "verified", detail: "live 402 pays the claimed address", paymentRequired, network: hit.network };
}

/** Calls the endpoint and checks its live 402 against the claimed pay-to. */
export async function verifyEndpoint(rawUrl: string, method: string, payTo: string): Promise<CheckResult> {
  const target = await safeTarget(rawUrl);
  if ("error" in target) return { status: "unreachable", detail: target.error };

  let response: Response;
  try {
    response = await fetch(target.url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": "x402-arc-facilitator-bazaar/1" },
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = (error as Error).name === "TimeoutError";
    return { status: "unreachable", detail: timedOut ? "timed out after 5s" : "request failed" };
  }
  // We only need the headers; never read a stranger's body.
  void response.body?.cancel().catch(() => {});

  if (response.status !== 402) {
    return { status: "unreachable", detail: `expected HTTP 402, got ${response.status}` };
  }
  const header = response.headers.get("payment-required");
  if (!header) return { status: "unreachable", detail: "402 has no PAYMENT-REQUIRED header" };

  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = decodePaymentRequiredHeader(header);
  } catch {
    return { status: "unreachable", detail: "PAYMENT-REQUIRED header is not valid x402" };
  }
  return matchPayTo(paymentRequired, payTo);
}

/* ------------------------------------------------------------------ *
 * Catalog writes
 * ------------------------------------------------------------------ */

type EndpointRow = {
  id: string;
  resource_url: string;
  method: string;
  pay_to: string;
  status: EndpointStatus;
  last_checked_at: string | null;
  settles_since_check: number;
};

const inFlight = new Set<string>();

/** Runs a check and stores the outcome. Never throws. */
async function checkAndStore(id: string, url: string, method: string, payTo: string): Promise<CheckResult | null> {
  if (inFlight.has(id)) return null;
  inFlight.add(id);
  try {
    const result = await verifyEndpoint(url, method, payTo);
    const pr = result.paymentRequired;
    const meta = pr?.resource ? sanitizeResourceServiceMetadata(pr.resource) : {};
    const discovery = (pr?.extensions as Record<string, unknown> | undefined)?.bazaar ?? null;

    await db().query(
      `update bazaar_endpoints set
         status = $2,
         status_detail = $3,
         last_checked_at = now(),
         settles_since_check = 0,
         verified_at = case when $2 = 'verified' then now() else verified_at end,
         network = coalesce($4, network),
         accepts = coalesce($5::jsonb, accepts),
         service_name = coalesce($6, service_name),
         icon_url = coalesce($7, icon_url),
         tags = coalesce($8, tags),
         description = coalesce($9, description),
         mime_type = coalesce($10, mime_type),
         discovery = coalesce($11::jsonb, discovery),
         updated_at = now()
       where id = $1`,
      [
        id,
        result.status,
        result.detail,
        result.network ?? null,
        result.status === "verified" && pr ? JSON.stringify(pr.accepts.filter((a) => networkByCaip2(a.network))) : null,
        meta.serviceName ?? null,
        meta.iconUrl ?? null,
        meta.tags ?? null,
        pr?.resource?.description?.slice(0, 500) ?? null,
        pr?.resource?.mimeType?.slice(0, 100) ?? null,
        discovery ? JSON.stringify(discovery) : null,
      ],
    );
    return result;
  } catch (error) {
    console.error("[bazaar] check failed:", (error as Error).message);
    return null;
  } finally {
    inFlight.delete(id);
  }
}

/** Defers work until the response is sent when inside a request; otherwise just runs it. */
function background(task: () => Promise<unknown>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

const needsCheck = (row: EndpointRow | undefined, payTo: string) =>
  !row ||
  row.status === "pending" ||
  row.pay_to !== payTo ||
  row.settles_since_check + 1 >= RECHECK_EVERY_SETTLES ||
  !row.last_checked_at ||
  Date.now() - new Date(row.last_checked_at).getTime() > RECHECK_AFTER_MS;

async function upsertEndpoint(fields: {
  url: string;
  method: string;
  payTo: string;
  source: "settle" | "register";
  serviceName?: string;
  description?: string;
  mimeType?: string;
  tags?: string[];
  iconUrl?: string;
  discovery?: unknown;
  countSettle: boolean;
}): Promise<{ id: string; check: boolean }> {
  await ensureSchema();
  const existing = (await db().query(
    `select id::text, resource_url, method, pay_to, status, last_checked_at::text, settles_since_check
       from bazaar_endpoints where resource_url = $1 and method = $2`,
    [fields.url, fields.method],
  )) as EndpointRow[];
  const check = needsCheck(existing[0], fields.payTo);

  const rows = (await db().query(
    `insert into bazaar_endpoints
       (resource_url, method, pay_to, origin, service_name, description, mime_type, tags, icon_url,
        discovery, source, settle_count, settles_since_check)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $12)
     on conflict (resource_url, method) do update set
       pay_to = excluded.pay_to,
       -- A different pay-to claim must be re-verified before it is shown.
       status = case when bazaar_endpoints.pay_to = excluded.pay_to then bazaar_endpoints.status else 'pending' end,
       service_name = coalesce(excluded.service_name, bazaar_endpoints.service_name),
       description = coalesce(excluded.description, bazaar_endpoints.description),
       mime_type = coalesce(excluded.mime_type, bazaar_endpoints.mime_type),
       tags = coalesce(excluded.tags, bazaar_endpoints.tags),
       icon_url = coalesce(excluded.icon_url, bazaar_endpoints.icon_url),
       discovery = coalesce(excluded.discovery, bazaar_endpoints.discovery),
       settle_count = bazaar_endpoints.settle_count + $12,
       settles_since_check = bazaar_endpoints.settles_since_check + $12,
       updated_at = now()
     returning id::text`,
    [
      fields.url,
      fields.method,
      fields.payTo,
      new URL(fields.url).origin,
      fields.serviceName ?? null,
      fields.description?.slice(0, 500) ?? null,
      fields.mimeType?.slice(0, 100) ?? null,
      fields.tags ?? null,
      fields.iconUrl ?? null,
      fields.discovery ? JSON.stringify(fields.discovery) : null,
      fields.source,
      fields.countSettle ? 1 : 0,
    ],
  )) as { id: string }[];
  return { id: rows[0]!.id, check };
}

/**
 * Called after every successful settlement. Catalogs the paid resource and
 * schedules a (re-)check when due. Never throws, never delays the settle.
 */
export async function recordSettle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<void> {
  try {
    const discovered = extractDiscoveryInfo(payload, requirements);
    const rawUrl = discovered?.resourceUrl ?? payload.resource?.url;
    if (!rawUrl) return;
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" && !ALLOW_PRIVATE) return;

    const payTo = requirements.payTo.toLowerCase();
    const method = (discovered && "method" in discovered && discovered.method) || "GET";
    const meta = sanitizeResourceServiceMetadata(payload.resource);
    const bazaar = (payload.extensions as Record<string, unknown> | undefined)?.bazaar;

    const { id, check } = await upsertEndpoint({
      url: `${url.origin}${url.pathname}`,
      method: method.toUpperCase(),
      payTo,
      source: "settle",
      ...meta,
      description: payload.resource?.description,
      mimeType: payload.resource?.mimeType,
      discovery: bazaar,
      countSettle: true,
    });
    if (check) background(() => checkAndStore(id, `${url.origin}${url.pathname}`, method.toUpperCase(), payTo));
  } catch (error) {
    console.error("[bazaar] could not record settle:", (error as Error).message);
  }
}

export type RegisterInput = {
  payTo: string;
  name?: string;
  website?: string;
  endpoints: (string | { url: string; method?: string })[];
};

export type RegisterResult = {
  merchant: { payTo: string; name: string | null; website: string | null };
  endpoints: { url: string; method: string; status: EndpointStatus; detail: string }[];
};

/** Validates a registration body. Returns an error message, or the normalised input. */
export function parseRegistration(body: unknown): { error: string } | { input: Required<RegisterInput> } {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object." };
  const b = body as Record<string, unknown>;
  if (typeof b.payTo !== "string" || !isAddress(b.payTo)) return { error: "`payTo` must be an EVM address." };
  if (!Array.isArray(b.endpoints) || b.endpoints.length === 0) {
    return { error: "`endpoints` must be a non-empty array of URLs." };
  }
  if (b.endpoints.length > MAX_REGISTER_ENDPOINTS) {
    return { error: `At most ${MAX_REGISTER_ENDPOINTS} endpoints per registration.` };
  }
  const endpoints: { url: string; method: string }[] = [];
  for (const e of b.endpoints) {
    const url = typeof e === "string" ? e : (e as { url?: unknown })?.url;
    const method = typeof e === "object" && e && typeof (e as { method?: unknown }).method === "string"
      ? String((e as { method: string }).method).toUpperCase()
      : "GET";
    if (typeof url !== "string" || url.length > 2048) return { error: "Each endpoint needs a `url` string." };
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return { error: `Unsupported method ${method}.` };
    endpoints.push({ url, method });
  }
  const name = typeof b.name === "string" && isValidServiceName(b.name) ? b.name : "";
  let website = "";
  if (typeof b.website === "string" && b.website) {
    try {
      const w = new URL(b.website);
      if (w.protocol === "https:" || w.protocol === "http:") website = w.origin;
    } catch {
      return { error: "`website` must be a URL." };
    }
  }
  return { input: { payTo: b.payTo.toLowerCase(), name, website, endpoints } };
}

/** The merchant's own code tells us: "this is my pay-to, these are my x402 endpoints". */
export async function registerMerchant(input: Required<RegisterInput>): Promise<RegisterResult> {
  await ensureSchema();
  await db().query(
    `insert into bazaar_merchants (pay_to, name, website) values ($1, nullif($2, ''), nullif($3, ''))
     on conflict (pay_to) do update set
       name = coalesce(nullif($2, ''), bazaar_merchants.name),
       website = coalesce(nullif($3, ''), bazaar_merchants.website),
       updated_at = now()`,
    [input.payTo, input.name, input.website],
  );

  const endpoints = await Promise.all(
    input.endpoints.map(async (entry) => {
      const { url: raw, method } = typeof entry === "string" ? { url: entry, method: "GET" } : { method: "GET", ...entry };
      const target = await safeTarget(raw);
      if ("error" in target) return { url: raw, method, status: "unreachable" as const, detail: target.error };
      const url = `${target.url.origin}${target.url.pathname}`;
      const { id } = await upsertEndpoint({ url, method: method!, payTo: input.payTo, source: "register", countSettle: false });
      const result = await checkAndStore(id, url, method!, input.payTo);
      return {
        url,
        method: method!,
        status: result?.status ?? ("pending" as const),
        detail: result?.detail ?? "check already in progress",
      };
    }),
  );

  return {
    merchant: { payTo: input.payTo, name: input.name || null, website: input.website || null },
    endpoints,
  };
}

/** Re-checks a few verified endpoints that have gone a day without a check. Cheap; called on reads. */
export function refreshStale(limit = 5): void {
  background(async () => {
    const rows = (await db().query(
      `select id::text, resource_url, method, pay_to from bazaar_endpoints
        where status = 'verified' and (last_checked_at is null or last_checked_at < now() - interval '1 day')
        order by last_checked_at nulls first limit $1`,
      [limit],
    )) as Pick<EndpointRow, "id" | "resource_url" | "method" | "pay_to">[];
    await Promise.all(rows.map((r) => checkAndStore(r.id, r.resource_url, r.method, r.pay_to)));
  });
}

/* ------------------------------------------------------------------ *
 * Catalog reads (verified only)
 * ------------------------------------------------------------------ */

type Row = {
  resource_url: string;
  method: string;
  pay_to: string;
  network: string | null;
  origin: string;
  service_name: string | null;
  description: string | null;
  mime_type: string | null;
  tags: string[] | null;
  icon_url: string | null;
  accepts: PaymentRequirements[] | null;
  discovery: Record<string, unknown> | null;
  verified_at: string | null;
  settle_count: number;
};

const COLUMNS = `resource_url, method, pay_to, network, origin, service_name, description, mime_type, tags,
  icon_url, accepts, discovery, verified_at, settle_count`;

/** Maps a row to the official bazaar `DiscoveryResource`. */
export function toDiscoveryResource(row: Row): DiscoveryResource {
  return {
    resource: row.resource_url,
    type: "http",
    x402Version: 2,
    accepts: row.accepts ?? [],
    lastUpdated: row.verified_at ?? new Date(0).toISOString(),
    ...(row.description ? { description: row.description } : {}),
    ...(row.mime_type ? { mimeType: row.mime_type } : {}),
    ...(row.service_name ? { serviceName: row.service_name } : {}),
    ...(row.tags?.length ? { tags: row.tags } : {}),
    ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
    ...(row.discovery ? { extensions: { bazaar: row.discovery } } : {}),
  };
}

export type ListFilters = { payTo?: string; network?: string; type?: string; limit: number; offset: number; query?: string };

export async function listVerified(f: ListFilters): Promise<{ rows: Row[]; total: number }> {
  await ensureSchema();
  const where = ["status = 'verified'"];
  const params: unknown[] = [];
  if (f.type && f.type !== "http") return { rows: [], total: 0 };
  if (f.payTo) {
    params.push(f.payTo.toLowerCase());
    where.push(`pay_to = $${params.length}`);
  }
  if (f.network) {
    params.push(f.network);
    where.push(`network = $${params.length}`);
  }
  if (f.query) {
    params.push(`%${f.query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    where.push(
      `(resource_url ilike ${p} or service_name ilike ${p} or description ilike ${p} or array_to_string(tags, ' ') ilike ${p})`,
    );
  }
  const clause = where.join(" and ");
  const [rows, count] = await Promise.all([
    db().query(
      `select ${COLUMNS} from bazaar_endpoints where ${clause}
        order by settle_count desc, verified_at desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, f.limit, f.offset],
    ),
    db().query(`select count(*)::int as total from bazaar_endpoints where ${clause}`, params),
  ]);
  return { rows: rows as Row[], total: Number(count[0]?.total ?? 0) };
}

export type MerchantSummary = {
  payTo: string;
  name: string | null;
  website: string | null;
  iconUrl: string | null;
  /** Every network this merchant has a verified endpoint on. */
  networks: string[];
  endpointCount: number;
  settleCount: number;
  lastVerifiedAt: string | null;
};

/**
 * One card per merchant (pay-to) with at least one verified endpoint.
 * `payTo` narrows it to a single merchant in SQL, so the 200 cap never hides one.
 */
export async function listMerchants(filter: { network?: string; payTo?: string } = {}): Promise<MerchantSummary[]> {
  await ensureSchema();
  const where = ["e.status = 'verified'"];
  const params: unknown[] = [];
  if (filter.network) {
    params.push(filter.network);
    where.push(`e.network = $${params.length}`);
  }
  if (filter.payTo) {
    params.push(filter.payTo.toLowerCase());
    where.push(`e.pay_to = $${params.length}`);
  }
  const rows = (await db().query(
    `select e.pay_to,
            coalesce(m.name, max(e.service_name))       as name,
            coalesce(m.website, min(e.origin))          as website,
            max(e.icon_url)                             as icon_url,
            array_agg(distinct e.network) filter (where e.network is not null) as networks,
            count(*)::int                               as endpoint_count,
            sum(e.settle_count)::int                    as settle_count,
            max(e.verified_at)                          as last_verified_at
       from bazaar_endpoints e
       left join bazaar_merchants m on m.pay_to = e.pay_to
      where ${where.join(" and ")}
      group by e.pay_to, m.name, m.website
      order by sum(e.settle_count) desc, max(e.verified_at) desc
      limit 200`,
    params,
  )) as Record<string, unknown>[];
  return rows.map((r) => ({
    payTo: String(r.pay_to),
    name: (r.name as string | null) ?? null,
    website: (r.website as string | null) ?? null,
    iconUrl: (r.icon_url as string | null) ?? null,
    networks: (r.networks as string[] | null) ?? [],
    endpointCount: Number(r.endpoint_count ?? 0),
    settleCount: Number(r.settle_count ?? 0),
    lastVerifiedAt: (r.last_verified_at as string | null) ?? null,
  }));
}

export async function getMerchant(payTo: string): Promise<{ merchant: MerchantSummary; endpoints: Row[] } | null> {
  const wanted = payTo.toLowerCase();
  const [merchants, { rows }] = await Promise.all([
    listMerchants({ payTo: wanted }),
    listVerified({ payTo: wanted, limit: MAX_MERCHANT_ENDPOINTS, offset: 0 }),
  ]);
  if (!merchants[0] || rows.length === 0) return null;
  return { merchant: merchants[0], endpoints: rows };
}

export type { Row as BazaarRow };
