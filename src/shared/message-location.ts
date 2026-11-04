/** UTF-16 offsets into one original message field, never rendered Markdown offsets. */
export interface MessageSourceRange {
  start: number;
  end: number;
  part?: "content" | "ui";
  partIndex?: number;
  excerpt?: string;
}

/** Transient search navigation; no generated knowledge and no persistent reading filter. */
export interface ReaderSearchHit { messageId:string; excerpt:string; sourceRange?:MessageSourceRange; sourceSignature?:string }
export interface ReaderSearchContext { query:string; hits:ReaderSearchHit[] }

/** Hash links are external input. Invalid positions fall back to message-level reading. */
export function parseMessageSourceRange(serialized: string | null): MessageSourceRange | undefined {
  if (!serialized || serialized.length > 4096) return undefined;
  try {
    const value = JSON.parse(serialized) as MessageSourceRange;
    if (!value || !Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.end) || value.start < 0 || value.end <= value.start || ![undefined, "content", "ui"].includes(value.part)) return undefined;
    if (value.part === "ui" && (!Number.isSafeInteger(value.partIndex) || value.partIndex! < 0)) return undefined;
    return { start: value.start, end: value.end, part: value.part, partIndex: value.partIndex, excerpt: typeof value.excerpt === "string" ? value.excerpt.slice(0, 4000) : undefined };
  } catch { return undefined; }
}

/** Search links travel through hashes and runtime messages; keep them bounded and drop malformed hits. */
export function readerSearchContext(value: unknown): ReaderSearchContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { query, hits } = value as { query?: unknown; hits?: unknown };
  if (typeof query !== "string" || !query.trim() || !Array.isArray(hits)) return undefined;
  const valid = hits.slice(0, 40).flatMap((hit: unknown) => {
    const item = hit as Partial<ReaderSearchHit> | null;
    if (!item || typeof item.messageId !== "string" || !item.messageId) return [];
    const sourceRange = item.sourceRange ? parseMessageSourceRange(JSON.stringify(item.sourceRange)) : undefined;
    return [{ messageId: item.messageId, excerpt: typeof item.excerpt === "string" ? item.excerpt.slice(0, 400) : "", ...(sourceRange ? { sourceRange } : {}) }];
  });
  return valid.length ? { query: query.slice(0, 200), hits: valid } : undefined;
}

export function parseReaderSearchContext(serialized: string | null): ReaderSearchContext | undefined {
  if (!serialized || serialized.length > 40000) return undefined;
  try { return readerSearchContext(JSON.parse(serialized)); } catch { return undefined; }
}

