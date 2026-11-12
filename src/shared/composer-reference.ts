import { codeRanges, readableConversationText } from "./conversation-text";

export const COMPOSER_REFERENCE_DIVIDER = "————————————";

function replaceProse(text: string, pattern: RegExp, render: (match: RegExpMatchArray) => string) {
  const protectedRanges = codeRanges(text);
  let cursor = 0, code = 0, result = "";
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    while (code < protectedRanges.length && protectedRanges[code][1] <= start) code++;
    if (code < protectedRanges.length && protectedRanges[code][0] <= start) continue;
    result += text.slice(cursor, start) + render(match);
    cursor = start + match[0].length;
  }
  return result + text.slice(cursor);
}

const WIKI_LOCATOR = /^[ \t]*(?:原文来源|Original source)(?:[ \t]+\[S-\d+-[\w-]+\])+[ \t]*(?:\n|$)|[ \t]*\[S-\d+-[\w-]+\]|\uE000SRC:[^\uE001]+\uE001/gmu;
const PROSE_MARKUP = /^#{1,6}[ \t]+|\*\*([^*\n]+)\*\*|__([^_\n]+)__|^\*([^*\n]+)\*$|(\n{3,})/gmu;

/** Simplify presentation in prose while keeping the literal code and table layout. */
export function plainComposerReference(content: string, omitWikiLocators = false): string {
  const text = readableConversationText(content).replace(/\r\n?/gu, "\n");
  const plain = omitWikiLocators ? replaceProse(text, WIKI_LOCATOR, () => "") : text;
  return replaceProse(plain, PROSE_MARKUP, match => match[1] ?? match[2] ?? match[3] ?? (match[4] ? "\n\n" : "")).trim();
}

/** Provenance, reference material and the line below which the user writes. */
export function formatComposerReference(intro: string, source: string, body: string): string {
  return `${intro}\n${source}\n\n${body.trim()}\n\n${COMPOSER_REFERENCE_DIVIDER}\n`;
}
