/**
 * Proves every allowlisted asset in lib/networks.ts against its own contract:
 * canonical EIP-3009 typehash, matching decimals, and — the part that silently
 * breaks everything when wrong — the EIP-712 domain the token signs with.
 *
 * Run this before trusting anything else. Exits non-zero on any mismatch and
 * prints the name/version pair that would have been correct.
 */

import { checkAllAssets } from "../lib/chain";
import { NETWORKS } from "../lib/networks";

const checks = await checkAllAssets();

for (const check of checks) {
  const { net, asset, resolved } = check;
  console.log(`\n${NETWORKS[net].name}  ${asset.symbol}  ${asset.address}`);
  console.log(`  decimals        ${check.decimalsOk ? "ok" : `MISMATCH (registry says ${asset.decimals})`}`);
  console.log(`  eip-3009        ${check.typehashOk ? "ok (canonical typehash)" : "MISSING OR NON-CANONICAL"}`);
  console.log(`  separator       ${check.onChainSeparator}`);

  if (!resolved) {
    console.log("  domain          UNRESOLVED — no candidate name/version reproduces the separator");
  } else if (resolved.name === asset.domain.name && resolved.version === asset.domain.version) {
    console.log(`  domain          ok  { name: ${JSON.stringify(resolved.name)}, version: ${JSON.stringify(resolved.version)} }`);
  } else {
    console.log(`  domain          MISMATCH — registry has ${JSON.stringify(asset.domain)}`);
    console.log(`                  chain wants { name: ${JSON.stringify(resolved.name)}, version: ${JSON.stringify(resolved.version)} }`);
  }
}

const bad = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - bad.length}/${checks.length} assets verified.`);

if (bad.length > 0) {
  console.error(`\n${bad.length} asset(s) do not match lib/networks.ts. Fix the registry before deploying.`);
  process.exit(1);
}
