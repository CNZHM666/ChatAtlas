const normalize = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1").replace(/[*`]/gu, "").replace(/\s+/gu, "").replace(/^[#>]+/u, "");

/** Match a verbatim excerpt inside its exact saved message; never guess another message. */
export function readerEvidenceTarget(message: HTMLElement, excerpt?: string, range?: MessageSourceRange): HTMLElement {
  if (range?.part === "ui") return [...message.querySelectorAll<HTMLElement>("[data-reader-ui-part]")].find(element => Number(element.dataset.readerUiPart) === range.partIndex) ?? message;
  if (range && Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start) {
    const blocks = [...message.querySelectorAll<HTMLElement>("[data-reader-source-start]")].filter(element => Number(element.dataset.readerSourceStart) <= range.start && Number(element.dataset.readerSourceEnd) >= range.end);
    if (blocks.length) return blocks.sort((a, b) => (Number(a.dataset.readerSourceEnd) - Number(a.dataset.readerSourceStart)) - (Number(b.dataset.readerSourceEnd) - Number(b.dataset.readerSourceStart)))[0];
    // Formatting can transform offsets. Only a unique excerpt can recover the
    // location; a repeated keyword must not jump to an arbitrary paragraph.
    const needle = normalize(range.excerpt ?? "");
    if (needle) {
      const matches = [...message.querySelectorAll<HTMLElement>("p, li, pre, .reader-long-text")].filter(block => normalize(block.textContent ?? "").includes(needle));
      if (matches.length === 1) return matches[0];
    }
    return message;
  }
  if (!excerpt?.trim()) return message;
  const needle = normalize(excerpt.replace(/^(?:user|assistant):\s*/u, ""));
  if (!needle) return message;
  const blocks = [...message.querySelectorAll<HTMLElement>("p, li, pre, blockquote, .reader-long-text")];
  return blocks.filter((block) => normalize(block.textContent ?? "").includes(needle)).sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0] ?? message;
}
import type { MessageSourceRange } from "../shared/message-location";
