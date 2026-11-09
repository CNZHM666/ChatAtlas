/** Sentences in the language they are written in: a Chinese one ends with 。, an English one with a period and is
 * separated from the one before by a space. One English run read "...v2 features.Bank syncing and receipt OCR...". */

const LATIN = /[A-Za-z0-9)\]"'’*%`]$/u;
const LATIN_TEXT = /[A-Za-z]{3}/u;
const CJK = /[㐀-鿿]/u;

/** Whether a text reads as English rather than Chinese. */
export const englishText = (text: string) => LATIN_TEXT.test(text) && !CJK.test(text);

/** A sentence ending with its language's stop. */
export function withStop(text: string): string {
  const trimmed = text.trim();
  if (/[。！？!?.]$/u.test(trimmed)) return trimmed;
  return `${trimmed}${englishText(trimmed) ? "." : "。"}`;
}

/** A paragraph with a sentence added at its end: after a list or table on a line of its own, else in the same line, with
 * a space between two English sentences. */
export function joinSentence(paragraph: string, sentence: string): string {
  const text = paragraph.trimEnd();
  if (!text) return sentence;
  if (paragraph.includes("\n")) return `${text}\n\n${sentence}`;
  const spaced = (LATIN.test(text) || /[.!?]$/u.test(text)) && /^[A-Za-z0-9"“(*`]/u.test(sentence);
  return `${text}${spaced ? " " : ""}${sentence}`;
}

/** English text with the Chinese punctuation the pipeline writes turned into English: "**Target User**：" → "**Target
 * User**: ", "（Product Scope）" → " (Product Scope)", "48px；" → "48px; ". Text in Chinese is left as it is. */
export function englishPunctuation(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*\s*：\s*/gu, "**$1**: ")
    .replace(/(^|[^\s])[ \t]*（([^（）\n]*)）/gmu, (whole, before: string, inner: string) => CJK.test(inner) ? whole : `${before}${before ? " " : ""}(${inner})`)
    .replace(/([A-Za-z0-9)\]*%`'"’])\s*：\s*/gu, "$1: ")
    .replace(/([A-Za-z0-9)\]*%`'"’])\s*；\s*/gu, "$1; ")
    .replace(/([A-Za-z0-9)\]*%`'"’])\s*，\s*/gu, "$1, ")
    .replace(/([A-Za-z0-9)\]*%`'"’])。/gu, "$1.")
    // Two sentences glued at a period ("excluded from v1.Specifically, bank syncing ..."); "database.ts" and "Node.js"
    // go on in lower case and stay. A version opens the next as well: "… useful features.V1 is strictly web-only …".
    .replace(/(?<![A-Za-z0-9_$.])([a-z][a-z0-9]*|[a-z]?\d+)\.((?:[A-Z][a-z]+|[vV]\d+)(?![\w(]))/gu, "$1. $2")
    // Or at a closing bracket after a word: "… (spending by category/weekly totals).Useful features include …".
    .replace(/([)\]])\.((?:[A-Z][a-z]+|[vV]\d+)(?![\w(]))/gu, "$1. $2")
    // A field name ending the first ("… createdAt, and updatedAt.Categories contain id, name …", "do not use
    // localStorage.Client-only transaction persistence …"), the next a word.
    .replace(/(?<![A-Za-z0-9_$.])([a-z]+[A-Z][a-z]+)\.([A-Z][a-z]{2,})(?=[\s-])/gu, "$1. $2");
}

/** A draft written in English with its punctuation made English throughout: body, paragraphs and claims alike, so each
 * claim is still found in its paragraph. */
export function englishDraftPunctuation(chapters: Array<{ body: string; paragraphs: Array<{ text: string; claims?: Array<{ text: string }> }> }>): number {
  let changed = 0;
  for (const chapter of chapters) {
    const body = englishPunctuation(chapter.body);
    if (body !== chapter.body) { chapter.body = body; changed++; }
    for (const paragraph of chapter.paragraphs) {
      paragraph.text = englishPunctuation(paragraph.text);
      for (const claim of paragraph.claims ?? []) claim.text = englishPunctuation(claim.text);
    }
  }
  return changed;
}
