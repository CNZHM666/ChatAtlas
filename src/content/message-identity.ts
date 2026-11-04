import { platformWidgetRanges } from "../shared/conversation-text";

export function normalizeMessageText(value: string): string {
  let fence: string | undefined;
  let blanks = 0;
  const normalizedNewlines = value.replace(/\r\n?/g, "\n");
  const widgets = platformWidgetRanges(normalizedNewlines);
  const lines = normalizedNewlines.split("\n");
  let offset = 0;
  const normalized = lines.flatMap((line) => {
    const start = offset; offset += line.length + 1;
    if (widgets.some(range => start < range.end && offset > range.start)) { blanks = 0; return [line]; }
    const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      blanks = 0; return [line];
    }
    // Spaces carry meaning in code, tables and text diagrams. Never compact them.
    if (fence || /^(?: {4}|\t)/u.test(line) || /[│┃┌┐└┘├┤┬┴┼─━]/u.test(line)) { blanks = 0; return [line]; }
    const prose = line.replace(/[\t ]+/g, " ").trimEnd();
    if (!prose) { blanks++; return blanks < 2 ? [""] : []; }
    blanks = 0; return [prose];
  }).join("\n").replace(/^\n+|\n+$/gu, "");
  return /^(?: {4}|\t)/u.test(normalized) ? normalized : normalized.trimStart();
}

export function previewMessage(value: string, maximum = 240): string {
  const compact = normalizeMessageText(value).replace(/\s+/g, " ");
  return compact.length <= maximum ? compact : `${compact.slice(0, maximum - 1).trimEnd()}…`;
}

export async function createContentHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeMessageText(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
