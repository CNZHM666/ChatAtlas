import type { ConversationMessage } from "./types";
import { platformWidgetRanges, codeRanges } from "./conversation-text";
import { DIL_PAYLOAD, dilRanges } from "./dil-source";

export type MessagePresentation = { kind: "text"; text: string; sourceStart?: number } | { kind: "ui"; raw: string; fallbackText?: string; truncated?: boolean; partIndex?: number };

/** Split only actual platform parts, never ordinary JSON, user text or code examples. */
export function messagePresentation(content: string, uiParts: ConversationMessage["uiParts"], literal = false, locations = false): MessagePresentation[] {
  if (literal) return [{ kind: "text", text: content, ...(locations ? { sourceStart: 0 } : {}) }];
  const ranges = platformWidgetRanges(content).map(range => ({ ...range, raw: range.payload, fallbackText: "", truncated: false, partIndex: undefined as number | undefined }));
  const protectedRanges = codeRanges(content);
  let ordinal = 0;
  for (const match of content.matchAll(/【原平台交互内容】/gu)) {
    const part = uiParts?.find(item => item.ordinal === ordinal++);
    if (!part || protectedRanges.some(([from, to]) => match.index! >= from && match.index! < to)) continue;
    const end = match.index! + match[0].length;
    const fallbackText = typeof part.fallbackText === "string" && content.slice(end).startsWith(`\n${part.fallbackText}`) ? part.fallbackText : "";
    ranges.push({ start: match.index!, end: end + (fallbackText ? fallbackText.length + 1 : 0), kind: "genui", payload: "", raw: typeof part.raw === "string" ? part.raw : "", fallbackText, truncated: Boolean(part.truncated), partIndex: uiParts!.indexOf(part) });
  }
  // ChatGPT component source in the text is folded into one readable card.
  for (const range of dilRanges(content)) ranges.push({ start: range.start, end: range.end, kind: "dil", payload: "", raw: JSON.stringify({ type: DIL_PAYLOAD, source: content.slice(range.start, range.end) }), fallbackText: "", truncated: false, partIndex: undefined });
  ranges.sort((a, b) => a.start - b.start);
  const segments: MessagePresentation[] = [];
  let copied = 0;
  for (const range of ranges.slice(0, 32)) {
    if (range.start < copied) continue;
    if (range.start > copied) segments.push({ kind: "text", text: content.slice(copied, range.start), ...(locations ? { sourceStart: copied } : {}) });
    segments.push({ kind: "ui", raw: range.raw, fallbackText: range.fallbackText, truncated: range.truncated, ...(locations ? { partIndex: range.partIndex } : {}) });
    copied = range.end;
  }
  if (copied < content.length) segments.push({ kind: "text", text: content.slice(copied), ...(locations ? { sourceStart: copied } : {}) });
  return segments.length ? segments : [{ kind: "text", text: content, ...(locations ? { sourceStart: 0 } : {}) }];
}

/** Recognize supplied markup only. A component ID/schema is not a downloaded UI. */
export function widgetMarkup(raw: string): { source: string; language: "html" | "svg"; height?: number } | undefined {
  if (raw.length > 200_000) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const root = value as Record<string, unknown>;
    const record = root.payload && typeof root.payload === "object" && !Array.isArray(root.payload) ? root.payload as Record<string, unknown> : root;
    const height = typeof record.height === "number" && Number.isFinite(record.height) && record.height >= 80 ? { height: Math.min(600, record.height) } : {};
    for (const key of ["html", "svg"] as const) if (typeof record[key] === "string") return { source: record[key], language: key };
    if (["html", "svg"].includes(String(record.type ?? record.content_type)) && typeof record.text === "string") return { source: record.text, language: String(record.type ?? record.content_type) as "html" | "svg", ...height };
    // MCP UI resources can include their complete HTML instead of a remote template URI.
    const contents = Array.isArray(record.contents) ? record.contents : [record];
    for (const resource of contents) {
      if (!resource || typeof resource !== "object") continue;
      const item = resource as Record<string, unknown>;
      if (typeof item.text === "string" && typeof item.mimeType === "string" && /^text\/html(?:;|$)/u.test(item.mimeType)) return { source: item.text, language: "html" };
    }
  } catch { /* Unknown payloads remain source-backed placeholders. */ }
  return undefined;
}
