/** Concise navigation label. Full authored text remains available to the reader. */
export function readingTitle(value: string, limit = 48): string {
  const title = value.replace(/\s+/gu, " ").trim();
  const first = title.length > limit ? title.split(/\s+\/\s+/u)[0] || title : title;
  const characters = Array.from(first);
  if (characters.length <= limit) return first;
  return characters.slice(0, limit - 1).join("").replace(/[，、：:;；\s]+$/u, "") + "…";
}
