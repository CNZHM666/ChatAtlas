/** Display-only cleanup for original messages shown as plain text. Platforms store
 * pasted documents with escaped Markdown (`\>`, `\*\*`, a trailing `\` per line);
 * the saved original is never changed. */
export function readableSourceText(text: string): string {
  return text
    .replace(/\\\r?\n/gu, "\n")
    .replace(/\\([\\`*_{}[\]()#+\-.!>|~<])/gu, "$1")
    .replace(/\\[ \t]*$/gmu, "")
    .replace(/\*\*|__/gu, "")
    .replace(/^[ \t]*(?:>[ \t]?)+/gmu, "")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gmu, "")
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gmu, "")
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** A user message that is mostly pasted material (an exported document, quoted AI
 * output), not the user's own words. Pasted text can repeat old AI suggestions, so
 * it must not read as "your message". */
export function pastedMaterial(text: string): boolean {
  if (/以下(?:是|为)(?:用户保存的)?历史参考(?:资料|快照)|Saved historical reference/iu.test(text)) return true;
  const quoted = text.match(/^[ \t]*\\?>/gmu)?.length ?? 0, escaped = text.match(/\\[>#*]/gu)?.length ?? 0, headings = text.match(/^[ \t]*\\?#{1,6}[ \t]/gmu)?.length ?? 0;
  return quoted >= 3 || escaped >= 3 || headings >= 2 && text.length > 400;
}
