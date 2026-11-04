import { normalizeMessageText } from "./message-identity";

/** Words only: Markdown markers, emphasis, zero-width characters and all whitespace removed, so the stored source
 * and the page's rendering of the same question compare equal. */
export function looseText(text: string): string {
  return normalizeMessageText(text)
    .replace(/(^|\s)(?:#{1,6}|>|[-*+]|\d+[.)])(?=\s)/gu, "$1")
    .replace(/[*_`~\u200b-\u200d\ufeff]|\s+/gu, "");
}

/** The page may add a label (an attachment name, "edited") or omit one the source kept; allow a small margin. */
export function sameQuestionText(shown: string, stored: string, truncated = false): boolean {
  const page = looseText(shown), saved = looseText(stored);
  if (!page || !saved) return false;
  if (page === saved || truncated && saved.length >= 12 && page.startsWith(saved)) return true;
  const [short, long] = page.length < saved.length ? [page, saved] : [saved, page];
  return short.length >= 12 && short.length / long.length >= .8 && long.includes(short);
}

/** A shadow root the page closed is still readable to an extension through chrome.dom. */
export function shadowOf(element: Element): ShadowRoot | null {
  if (element.shadowRoot) return element.shadowRoot;
  try { return element.nodeType === Node.ELEMENT_NODE && typeof chrome !== "undefined" ? chrome.dom?.openOrClosedShadowRoot?.(element as HTMLElement) ?? null : null; }
  catch { return null; }
}

/** Every place the page may render text: the document, open and closed shadow roots at any depth, and same-origin
 * frames. ChatAtlas's own UI is skipped. */
export function pageRoots(root: Document | ShadowRoot = document): Array<Document | ShadowRoot> {
  const roots: Array<Document | ShadowRoot> = [], queue: Array<Document | ShadowRoot> = [root];
  while (queue.length && roots.length < 200) {
    const scope = queue.shift()!;
    roots.push(scope);
    for (const element of scope.querySelectorAll<HTMLElement>("*")) {
      if (element.closest(SKIPPED)) continue;
      const shadow = shadowOf(element);
      if (shadow) queue.push(shadow);
      if (element.localName === "iframe") { try { const inner = (element as HTMLIFrameElement).contentDocument; if (inner?.body) queue.push(inner); } catch { /* Cross-origin frames stay closed. */ } }
    }
  }
  return roots;
}

const SKIPPED = 'aside, nav, form, [contenteditable="true"], script, style, noscript, template, [hidden], [id^="atlas-"], [class*="atlas-"]';

/** Find the question on the page by its text alone, whatever markup the platform uses: start from text nodes that
 * hold part of it and climb to the smallest block that shows the whole question and little else. Open shadow roots
 * are searched too; ChatAtlas's own panels and the input box never count. */
export function findQuestionBlock(text: string, truncated = false, root: Document | ShadowRoot = document): HTMLElement | null {
  const wanted = looseText(text);
  if (wanted.length < 8) return null;
  const limit = truncated ? Number.POSITIVE_INFINITY : wanted.length * 1.15 + 12;
  const roots = pageRoots(root);
  const found: Array<{ block: HTMLElement; exact: boolean }> = [];
  for (const scope of roots) {
    // A frame's document belongs to another window, so test the node type rather than instanceof.
    const isDocument = scope.nodeType === Node.DOCUMENT_NODE, start = isDocument ? (scope as Document).body : scope;
    if (!start) continue;
    const walker = (isDocument ? scope as Document : scope.ownerDocument!).createTreeWalker(start, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const part = looseText(node.nodeValue ?? "");
      if (part.length < 2 || !wanted.includes(part.slice(0, 12)) || node.parentElement?.closest(SKIPPED)) continue;
      for (let block = node.parentElement; block; block = block.parentElement) {
        const own = looseText(block.textContent ?? "");
        if (own.length > limit) break;
        if (own.includes(wanted)) { if (!found.some(item => item.block === block)) found.push({ block, exact: own === wanted }); break; }
      }
    }
  }
  const smallest = found.filter(item => !found.some(other => other !== item && item.block.contains(other.block)));
  const exact = smallest.filter(item => item.exact), pick = exact.length ? exact : smallest;
  return pick.length === 1 ? pick[0].block : null;
}
