import { sourceMessageSignature } from "./source-signature";

export const wikiTableCells = (line: string) => line.trim().replace(/^(?:>\s*)+/u, "")
  .replace(/^\||(?<!\\)\|$/gu, "").split(/(?<!\\)\|/u).map(value => value.trim());

export function wikiTableKey(text: string) {
  return JSON.stringify(text.trim().split(/\r?\n/u).filter((_, index) => index !== 1)
    .map(line => wikiTableCells(line).map(cell => cell.replace(/\*\*|__/gu, "").normalize("NFKC").replace(/\s+/gu, " ").trim())));
}

export const wikiTableSignature = (text: string) => sourceMessageSignature(wikiTableKey(text));
