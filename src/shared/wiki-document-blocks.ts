import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { WikiClaim } from "./wiki-claims";

const parser = unified().use(remarkParse).use(remarkGfm);
const plain = (text: string) => text.replace(/\*\*|__/gu, "");
const parsedBlocks = new Map<string, ReturnType<typeof parseBlocks>>();

function parseBlocks(body: string) {
  return parser.parse(body).children.map(node => {
    const start = node.position!.start.offset!, end = node.position!.end.offset!;
    const text = body.slice(start, end);
    return {
      kind: node.type, start, end, text,
      standaloneLabel: node.type === "paragraph" && node.children.length === 1 && (node.children[0].type === "strong" || node.children[0].type === "emphasis"),
    };
  });
}

/** Shared boundaries for reading, evidence review and export. Offsets point into
 * the saved Markdown so a projection can replace a block without reserializing it. */
export function wikiDocumentBlocks(body: string, claims: readonly WikiClaim[] = []) {
  let blocks = parsedBlocks.get(body);
  if (!blocks) {
    if (parsedBlocks.size >= 120) parsedBlocks.clear();
    parsedBlocks.set(body, blocks = parseBlocks(body));
  }
  return blocks.map(block => {
    const text = plain(block.text);
    return { ...block, claims: block.kind === "paragraph" || block.kind === "table" ? claims.filter(claim =>
      [claim.text, ...claim.formulations ?? []].some(form => form && text.includes(plain(form)))) : [] };
  });
}

const PRICE_COLUMN = /定价|价格|收费|售价|资费|\b(?:price|pricing|cost|fee)\b/iu;
const MONEY = /(?:[¥￥$€£]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:元|(?:USD|CNY|EUR)\b))/giu;
const PRICE_NOTE = /具体价格待确认|specific prices require confirmation/iu;
const ORIGINAL_PRICE_TABLE = /讨论中的原文表格|Table from the discussion|(?:对照表|Table).*AI\s*(?:建议|suggestion)/iu;
const moneyValues = (text: string) => [...text.normalize("NFKC").matchAll(MONEY)].map(match => match[0].replace(/\s+/gu, "").toUpperCase());

/** A confirmation of the payment model does not cover price cells. Label the
 * whole comparison when any listed amount lacks its own confirmation. */
export function qualifyWikiPriceTables(body: string, claims: readonly WikiClaim[], accepted: ReadonlySet<WikiClaim>, zh: boolean) {
  if (!PRICE_COLUMN.test(body) || !body.includes("|")) return body;
  const blocks = wikiDocumentBlocks(body, claims);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  for (const [index, block] of blocks.entries()) {
    if (block.kind !== "table" || !PRICE_COLUMN.test(block.text.split("\n")[0])) continue;
    const rows = block.text.split("\n").slice(2);
    const priced = rows.map(row => ({ row, values: moneyValues(row) })).filter(item => item.values.length);
    const caption = blocks[index - 1];
    if (!priced.length || PRICE_NOTE.test(caption?.text ?? "")) continue;
    const confirmed = ({ row, values }: typeof priced[number]) => block.claims.some(claim =>
      accepted.has(claim) && row.includes(claim.text) && values.every(value => moneyValues(claim.text).includes(value)));
    if (priced.every(confirmed)) continue;
    const original = caption?.standaloneLabel && ORIGINAL_PRICE_TABLE.test(caption.text);
    const proposed = block.claims.some(claim => !accepted.has(claim) && (claim.holder === "ai" || claim.workStatus === "proposed") && moneyValues(claim.text).length)
      || original && /AI\s*(?:建议|suggestion)/iu.test(caption.text);
    const prefix = proposed ? (zh ? (original ? "原文中的 AI 定价建议" : "AI 提出的定价方案") : "Pricing proposed by AI")
      : (zh ? "讨论中的定价方案" : "Pricing discussed");
    const note = zh ? `${prefix}，具体价格待确认。` : `${prefix}. Specific prices require confirmation.`;
    const pending = new Set(priced.filter(item => !confirmed(item)).map(item => item.row));
    const table = original ? block.text : block.text.split("\n").map(row => pending.has(row)
      ? row.replace(/内测期主推/gu, "内测期建议主推").replace(/当前主推/gu, "讨论中建议主推").replace(/\bcurrent(?:ly)? promoted\b/giu, "suggested for promotion")
      : row).join("\n");
    edits.push({ start: original && proposed ? caption.start : block.start, end: block.end, text: `${note}\n\n${table}` });
  }
  return edits.reverse().reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), body);
}
