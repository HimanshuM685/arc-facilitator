/**
 * Applies the payment-log schema (lib/schema.ts) to every network's table.
 * The app also does this on first use; this is for doing it up front.
 * Idempotent, so running it against a live database is safe.
 */

import { ensureSchema } from "../lib/db";
import { NETWORK_KEYS, NETWORKS } from "../lib/networks";

await ensureSchema();
for (const net of NETWORK_KEYS) console.log(`${NETWORKS[net].name.padEnd(20)} ${NETWORKS[net].table}`);
console.log("\nMigration complete.");
