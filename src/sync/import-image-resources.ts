import { imageAliases, imageLinks, importedImage, bytesDataUrl, MAX_IMAGE_BYTES, type ImportedImageResource } from "../shared/conversation-images";

export interface ZipImageEntry { name: string; read(): Promise<Uint8Array> }
const mimeTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", bmp: "image/bmp" };
export const zipImageMime = (name: string) => mimeTypes[name.split(".").at(-1)?.toLowerCase() ?? ""];

export function imageResourceReader(entries: ZipImageEntry[], onError?: (name: string, message: string) => void) {
  const index = new Map<string, ZipImageEntry | undefined>();
  for (const entry of entries) for (const alias of imageAliases(entry.name)) {
    if (!index.has(alias)) index.set(alias, entry);
    else if (index.get(alias) !== entry) index.set(alias, undefined);
  }
  return async (raw: unknown): Promise<ImportedImageResource[]> => {
    const references = new Set<string>();
    let visited = 0;
    const walk = (value: unknown, depth = 0) => {
      if (depth > 32 || ++visited > 200_000) return;
      if (typeof value === "string") {
        for (const link of imageLinks(value)) references.add(link.source);
        // Gemini Takeout HTML is not Markdown yet.
        for (const match of value.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/giu)) references.add(match[1].replace(/&amp;/gu, "&"));
      } else if (value && typeof value === "object") {
        const image = importedImage(value);
        if (image) for (const link of imageLinks(image)) references.add(link.source);
        for (const child of Object.values(value)) walk(child, depth + 1);
      }
    };
    walk(raw);
    const selected = new Map<ZipImageEntry, string[]>();
    for (const reference of references) {
      const matches = [...new Set(imageAliases(reference).map(alias => index.get(alias)).filter((entry): entry is ZipImageEntry => Boolean(entry)))];
      if (matches.length !== 1) continue;
      const entry = matches[0]; selected.set(entry, [...selected.get(entry) ?? [], reference]);
    }
    const resources: ImportedImageResource[] = [];
    let retained = 0;
    for (const [entry, references] of selected) {
      try {
        const bytes = await entry.read();
        if (bytes.length > MAX_IMAGE_BYTES || retained + bytes.length > 100 * 1024 * 1024) throw Error("Image exceeds the local import size limit.");
        retained += bytes.length;
        resources.push({ references, dataUrl: bytesDataUrl(bytes, zipImageMime(entry.name)!) });
      } catch (error) { onError?.(entry.name, error instanceof Error ? error.message : String(error)); }
    }
    return resources;
  };
}
