import { bytesDataUrl, imageLinks, MAX_IMAGE_BYTES, originalImageReference, rasterDataUrl, type ImportedImageResource } from "../shared/conversation-images";
import type { ParsedChatMessage } from "./capture-adapter";

// Only resources actually present in a captured message are read, in the source page's session.
const cache = new Map<string, Promise<ImportedImageResource | undefined>>();
async function readImage(source: string): Promise<ImportedImageResource | undefined> {
  if (rasterDataUrl(source)) return { references: [source], dataUrl: source };
  if (!/^(?:https?:\/\/|blob:)/iu.test(source)) return;
  const url = new URL(source, location.href);
  const response = await fetch(url.href, { credentials: url.origin === location.origin ? "include" : "omit", signal: AbortSignal.timeout(8000) });
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) return;
  const mime = response.headers.get("content-type")?.split(";")[0];
  if (!mime || !/^image\/(?:png|jpe?g|gif|webp|avif|bmp)$/iu.test(mime) || !response.body) return;
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.length;
      if (size > MAX_IMAGE_BYTES) { await reader.cancel(); return; }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return { references: [source], dataUrl: bytesDataUrl(bytes, mime) };
}

export async function captureImageResources(messages: ParsedChatMessage[]): Promise<ImportedImageResource[]> {
  const sources = [...new Set(messages.flatMap(message => imageLinks(message.text).map(link => originalImageReference(link.source))))];
  const results: ImportedImageResource[] = [];
  let next = 0, retained = 0;
  const deadline = Date.now() + 10_000, limit = 24 * 1024 * 1024;
  await Promise.all(Array.from({ length: Math.min(2, sources.length) }, async () => {
    while (next < sources.length && retained < limit && Date.now() < deadline) {
      const source = sources[next++];
      let pending = cache.get(source);
      if (!pending) {
        pending = readImage(source).catch(() => undefined);
        cache.set(source, pending);
        while (cache.size > 8) cache.delete(cache.keys().next().value!);
      }
      const result = await pending;
      if (result && retained + result.dataUrl.length <= limit) { retained += result.dataUrl.length; results.push(result); }
      else cache.delete(source); // A temporarily expired session may succeed on the next capture.
    }
  }));
  return results;
}
