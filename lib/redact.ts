/**
 * Error text that is safe to store and publish.
 *
 * Raw errors from viem and the RPC layer are not. They embed the endpoint URL
 * (which may carry an API key) and, for a failed contract write, the decoded
 * call arguments — which for `transferWithAuthorization` include the payer's
 * signature and authorization fields. Settlement failures end up in the payment
 * log, which is served publicly by /api/logs, so anything that reaches
 * `error_reason` has to go through here first.
 */

const URL_PATTERN = /\b(?:https?|wss?):\/\/\S+/gi;
const HEX_BLOB_PATTERN = /0x[0-9a-fA-F]{40,}/g;

export function safeErrorMessage(error: unknown, maxLength = 300): string {
  const raw = error instanceof Error ? error.message : String(error);

  return raw
    .replace(URL_PATTERN, "<url>")
    // Catches signatures, calldata and any other long hex run. Addresses (40
    // hex chars) and tx hashes (64) are fine to keep, but they are shorter than
    // the blobs we care about only by luck, so this is deliberately aggressive:
    // a redacted address in a log line costs nothing, a published signature does.
    .replace(HEX_BLOB_PATTERN, "<hex>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
