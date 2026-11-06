/**
 * Payment-log DDL, one table per network. Kept in TypeScript (not a .sql file)
 * so it ships inside the server bundle: the app applies it itself on first use,
 * and `pnpm migrate` applies the same statements by hand.
 *
 * Templated per network on purpose: the stats and log queries assume both
 * tables have an identical shape, so they must not be able to drift.
 *
 * Nothing replayable is stored: no signatures, no authorization nonces.
 * Every statement is idempotent, so re-running is always safe.
 */

export const schemaFor = (table: string): string[] => [
  `create table if not exists ${table} (
    id            bigserial primary key,
    created_at    timestamptz not null default now(),
    kind          text        not null check (kind in ('verify', 'settle')),
    ok            boolean     not null,
    error_reason  text,
    network       text        not null,
    scheme        text        not null,
    asset         text,
    asset_symbol  text,
    payer         text,
    pay_to        text,
    amount        numeric(78, 0),
    resource      text,
    tx_hash       text,
    gas_used      numeric(78, 0),
    gas_cost_wei  numeric(78, 0),
    latency_ms    integer
  )`,
  // Keyset pagination for the public log orders by (created_at, id).
  `create index if not exists ${table}_created_id_idx on ${table} (created_at desc, id desc)`,
  `create index if not exists ${table}_payer_idx on ${table} (payer)`,
  `create index if not exists ${table}_payto_idx on ${table} (pay_to)`,
  // A retried settle that re-logs an already-broadcast transaction hits this
  // instead of producing a duplicate row.
  `create unique index if not exists ${table}_tx_idx on ${table} (tx_hash) where tx_hash is not null`,
  // Superseded indexes from earlier versions.
  `drop index if exists ${table}_created_idx`,
  `drop index if exists ${table}_settle_day_idx`,
  `drop index if exists ${table}_settle_spend_idx`,
];

/**
 * Bazaar catalog — network-independent, applied once.
 *
 * A merchant is a pay-to address. Endpoints are listed only while `status` is
 * 'verified': we called the URL ourselves and its live 402 named that pay-to.
 */
export const bazaarSchema: string[] = [
  `create table if not exists bazaar_merchants (
    pay_to      text primary key,
    name        text,
    website     text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
  )`,
  `create table if not exists bazaar_endpoints (
    id                   bigserial primary key,
    resource_url         text        not null,
    method               text        not null default 'GET',
    pay_to               text        not null,
    network              text,
    origin               text        not null,
    service_name         text,
    description          text,
    mime_type            text,
    tags                 text[],
    icon_url             text,
    accepts              jsonb,
    discovery            jsonb,
    status               text        not null default 'pending'
                         check (status in ('pending', 'verified', 'mismatch', 'unreachable')),
    status_detail        text,
    verified_at          timestamptz,
    last_checked_at      timestamptz,
    settle_count         integer     not null default 0,
    settles_since_check  integer     not null default 0,
    source               text        not null check (source in ('settle', 'register')),
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now()
  )`,
  `create unique index if not exists bazaar_endpoints_url_method_idx on bazaar_endpoints (resource_url, method)`,
  `create index if not exists bazaar_endpoints_payto_status_idx on bazaar_endpoints (pay_to, status)`,
];
