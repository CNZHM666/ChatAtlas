export function cleanConversationOverviewTitle(value: string): string {
  const printable = Array.from(value).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f) && codePoint !== 0xfffd;
  }).join("");

  return printable
    .replace(/\s*\$+\s*$/u, "")
    .trim();
}
