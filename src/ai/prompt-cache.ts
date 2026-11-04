import { sourceMessageSignature } from "../shared/source-signature";

/** Provider-side prompt caching only changes the wire format, never the text a
 * model reads or Atlas's own request/cache identity. The cacheable prefix ends
 * before the first per-batch instruction; everything after it varies by batch
 * or repair and is sent uncached. */
const PER_REQUEST_MARKERS = [
  "\nGLOBAL WIKI TOPIC OWNERSHIP",
  " TARGETED COMPLETION:",
  " TARGETED FORMAT CORRECTION:",
  " The previous response failed validation.",
];

// Providers ignore cache hints below about 1024 tokens; a shorter prefix gains
// nothing, so it stays a plain string for maximum compatibility.
export const MIN_CACHEABLE_PREFIX_CHARACTERS = 4000;

export function splitCacheablePrefix(system: string): { prefix: string; suffix: string } {
  const cut = Math.min(...PER_REQUEST_MARKERS.map(marker => system.indexOf(marker)).filter(index => index >= 0), system.length);
  return { prefix: system.slice(0, cut), suffix: system.slice(cut) };
}

export const cacheablePrefix = (system: string) => {
  const { prefix } = splitCacheablePrefix(system);
  return prefix.length >= MIN_CACHEABLE_PREFIX_CHARACTERS ? prefix : undefined;
};

/** Stable short routing key for an identical prefix (OpenAI prompt_cache_key). */
export const promptCacheKey = (prefix: string) => `atlas-${sourceMessageSignature(prefix)}`.slice(0, 64);

// A cache write costs more than a plain read on Anthropic. Only mark a prefix
// once it has already been sent recently, so one-off requests never pay for a
// write that no later request reuses.
const PREFIX_TTL_MS = 5 * 60_000;
const MAX_TRACKED_PREFIXES = 32;
const recentPrefixes = new Map<string, number>();

export function prefixSeenRecently(prefix: string, now = Date.now()): boolean {
  const key = sourceMessageSignature(prefix);
  for (const [tracked, at] of recentPrefixes) if (now - at > PREFIX_TTL_MS) recentPrefixes.delete(tracked);
  const seen = recentPrefixes.has(key);
  recentPrefixes.delete(key);
  recentPrefixes.set(key, now);
  while (recentPrefixes.size > MAX_TRACKED_PREFIXES) recentPrefixes.delete(recentPrefixes.keys().next().value!);
  return seen;
}

export function resetPromptCacheTracking() { recentPrefixes.clear(); }

/** Only first-party hosts get vendor cache parameters; compatible gateways may
 * reject unknown fields and generally apply their own automatic prefix cache. */
export function officialHost(baseUrl: string, host: string): boolean {
  try { const url = new URL(baseUrl); return url.protocol === "https:" && url.hostname === host; } catch { return false; }
}
