import type { ConversationMessage } from "./types";

/** Typed UI payloads only. Ordinary code/JSON examples remain ordinary conversation text. */
export function importUIPart(value: Record<string, unknown>, parts: NonNullable<ConversationMessage["uiParts"]>, ordinal: number): string | undefined {
  if (!["genui", "interactive", "widget", "html", "svg"].includes(String(value.type ?? value.content_type))) return;
  const raw = JSON.stringify(value), truncated = raw.length + parts.reduce((sum, part) => sum + part.raw.length, 0) > 200_000;
  if (parts.length < 32) parts.push({ ordinal, raw: truncated ? "" : raw, ...(truncated ? { truncated: true } : {}) });
  return "【原平台交互内容】";
}
