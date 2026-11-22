import { sourceMessageSignature } from "./source-signature";

export const wikiTableCells = (line: string) => line.trim().replace(/^(?:>\s*)+/u, "")
  .replace(/^\||(?<!\\)\|$/gu, "").split(/(?<!\\)\|/u).map(value => value.trim());

/** Avoid GFM silently truncating extra cells. Preserve ambiguous cells as
 * separate text instead of assigning them to a heading they may not belong to. */
export function repairGeneratedWikiTable(text: string) {
  const [header, separator, ...rows] = text.split("\n");
  const columns = wikiTableCells(header).length;
  if (!separator || columns < 2 || !wikiTableCells(separator).every(cell => /^:?-{3,}:?$/u.test(cell))) return text;
  const valid: string[] = [], overflow: string[] = [];
  for (const row of rows) {
    const cells = wikiTableCells(row);
    if (cells.length === columns) valid.push(row);
    else overflow.push(cells.filter(Boolean).map(cell => "- " + cell.replace(/\\\|/gu, "|")).join("\n"));
  }
  if (!overflow.length) return text;
  return [...(valid.length ? [[header, separator, ...valid].join("\n")] : []), ...overflow.filter(Boolean)].join("\n\n");
}

export function wikiTableKey(text: string) {
  return JSON.stringify(text.trim().split(/\r?\n/u).filter((_, index) => index !== 1)
    .map(line => wikiTableCells(line).map(cell => cell.replace(/\*\*|__/gu, "").normalize("NFKC").replace(/\s+/gu, " ").trim())));
}

export const wikiTableSignature = (text: string) => sourceMessageSignature(wikiTableKey(text));

/** Compare retained cells without depending on the original row order or inline code styling. */
export function wikiTableRows(text: string) {
  const [header = [], ...rows] = text.trim().split(/\r?\n/u).filter((_, index) => index !== 1)
    .map(line => wikiTableCells(line).map(cell => cell.replace(/`([^`]+)`/gu, "$1")
      .replace(/\*\*|__/gu, "").normalize("NFKC").replace(/\s+/gu, " ").trim()));
  return { header: JSON.stringify(header), rows: rows.map(row => JSON.stringify(row)) };
}
