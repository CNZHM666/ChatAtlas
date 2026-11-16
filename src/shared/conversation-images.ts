import { codeRanges } from "./conversation-text";

export interface ConversationImageAsset { id: string; dataUrl: string }
export interface ImportedImageResource { references: string[]; dataUrl: string }
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
export const rasterDataUrl = (value: string) => /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/iu.test(value) && value.length <= MAX_IMAGE_BYTES * 1.4;
export const viewableImageUrl = (value: string) => /^https?:\/\/[^\s<>]+$/iu.test(value) || rasterDataUrl(value);

/** Keep unavailable provider pointers as images, so a missing attachment never silently disappears. */
export function imageMarkdown(source: string, alt = "图片 / Image"): string {
  if (!source.trim()) return "";
  const url = viewableImageUrl(source) || source.startsWith("atlas-image:") ? source : `atlas-image:${encodeURIComponent(source)}`;
  return `![${alt.replace(/[[\]\\\r\n]/gu, " ")}](<${url.replace(/[<>\r\n]/gu, character => encodeURIComponent(character))}>)`;
}

/** Typed multimodal parts shared by official and generic importers. Never guess from ordinary prose. */
export function importedImage(part: unknown): string | undefined {
  if (!part || typeof part !== "object" || Array.isArray(part)) return undefined;
  const item = part as Record<string, unknown>, type = String(item.type ?? item.content_type ?? "");
  const source = item.source && typeof item.source === "object" ? item.source as Record<string, unknown> : undefined;
  const inline = (item.inlineData ?? item.inline_data) as Record<string, unknown> | undefined;
  const file = (item.fileData ?? item.file_data) as Record<string, unknown> | undefined;
  let url: unknown;
  if (inline && typeof inline.data === "string" && /^image\//u.test(String(inline.mimeType ?? inline.mime_type))) url = `data:${inline.mimeType ?? inline.mime_type};base64,${inline.data}`;
  else if (file && /^image\//u.test(String(file.mimeType ?? file.mime_type))) url = file.fileUri ?? file.file_uri;
  else if (/^(?:image|image_asset_pointer|image_url|input_image|output_image)$/u.test(type)) {
    const imageUrl = item.image_url;
    url = item.asset_pointer ?? item.url ?? item.src ?? (typeof imageUrl === "string" ? imageUrl : imageUrl && typeof imageUrl === "object" ? (imageUrl as Record<string, unknown>).url : undefined)
      ?? (source?.type === "base64" && typeof source.data === "string" ? `data:${source.media_type};base64,${source.data}` : source?.url)
      ?? (typeof item.source === "string" ? item.source : undefined)
      ?? item.path ?? item.file_name ?? item.id;
  } else if (typeof item.file_name === "string" && /\.(?:png|jpe?g|gif|webp|avif|bmp)$/iu.test(item.file_name)) url = item.url ?? item.file_name;
  return typeof url === "string" ? imageMarkdown(url, typeof item.alt === "string" ? item.alt : typeof item.file_name === "string" ? item.file_name : undefined) : undefined;
}

export interface ImageLink { start: number; end: number; source: string }
export function imageLinks(content: string): ImageLink[] {
  if (!content.includes("![")) return [];
  const protectedRanges = codeRanges(content);
  return [...content.matchAll(/!\[(?:\\.|[^\]\\])*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+"[^"\n]*")?\s*\)/gu)].flatMap(match => {
    if (protectedRanges.some(([start, end]) => match.index! >= start && match.index! < end)) return [];
    const source = match[1] ?? match[2], offset = match[0].indexOf(source, match[0].indexOf("]("));
    return [{ start: match.index! + offset, end: match.index! + offset + source.length, source }];
  });
}

export function originalImageReference(value: string): string {
  if (!value.startsWith("atlas-image:")) return value;
  try { return decodeURIComponent(value.slice(12)); } catch { return value.slice(12); }
}

/** Exact path/file-ID aliases only; ambiguous basenames must never attach somebody else's image. */
export function imageAliases(value: string): string[] {
  let path = originalImageReference(value);
  try { path = decodeURIComponent(path); } catch { /* Retain malformed source verbatim. */ }
  path = path.replace(/^(?:sediment|file-service):\/\//u, "").replace(/^sandbox:(?:\/mnt\/data\/)?/u, "").replace(/\\/gu, "/").replace(/^\.\//u, "");
  const name = path.split("/").at(-1) ?? path;
  const fileId = /^(file[-_][a-z\d]+)(?=[_.-]|$)/iu.exec(name)?.[1];
  return [...new Set([path, name, ...(fileId ? [fileId] : [])])];
}

export function bytesDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 8192) binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
