import { wikiLedgerUnits, type WikiKnowledgeLedger, type WikiKnowledgeUnit } from "./wiki-knowledge";
import { messageCode } from "./wiki-source-code";

/** A message as the sections pass reads it. */
export interface WikiSectionMessage { id: string; conversationId: string; messageIndex: number; content: string }

const SEPARATOR = /^\s*[=\-─━_*~]{5,}\s*$/u;
const MARKDOWN = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/u;
const BOLD = /^\s*\*\*([^*]{1,40})\*\*\s*[:：]?\s*$/u;
const CHINESE_NUMBERED = /^\s*(?:[一二三四五六七八九十百]+|第[一二三四五六七八九十百\d]+[章节部分])[、.．:：]\s*(\S.{0,38})$/u;
const TITLE_LABEL = /^\s*(?:标题|Title)\s*[:：]\s*(.*)$/iu;
const MAX_HEADING = 40;

/** A heading's own words: numbering ("十二、", "14. ", "九、") and marks dropped. */
function headingWords(text: string): string {
  return text.replace(/\*\*/gu, "").replace(/^\s*(?:第?[一二三四五六七八九十百\d]+(?:\.\d+)*[章节部分]?[、.．:：)）]?)\s*/u, "").replace(/[:：]\s*$/u, "").trim();
}

/** The heading a line is, given the lines around it, if it is one. */
function headingAt(lines: string[], at: number): string | undefined {
  const heading = headingLine(lines, at);
  // A sentence set in bold ("**Currency handling stays simple.**") leads a paragraph; it names no part. As a label it
  // read "Currency handling stays simple.: State that spending stays in the browser".
  return heading && !/[.。!！?？]$/u.test(heading) ? heading : undefined;
}

function headingLine(lines: string[], at: number): string | undefined {
  const line = lines[at];
  if (!line.trim() || SEPARATOR.test(line) || line.trim().length > MAX_HEADING + 6) return undefined;
  const markdown = line.match(MARKDOWN)?.[1] ?? line.match(BOLD)?.[1] ?? line.match(CHINESE_NUMBERED)?.[0];
  if (markdown) return headingWords(markdown) || undefined;
  const near = (step: number) => { for (let index = at + step; index >= 0 && index < lines.length; index += step) if (lines[index].trim()) return lines[index]; return ""; };
  // A title label ("标题：需要这些零件", or "标题：" above it).
  const label = line.match(TITLE_LABEL)?.[1].trim();
  if (label) return headingWords(label) || undefined;
  if (near(-1).match(TITLE_LABEL)?.[1].trim() === "") return headingWords(line) || undefined;
  // A line set between two separator lines ("=====\n十二、圆角\n=====").
  if (SEPARATOR.test(near(-1)) && SEPARATOR.test(near(1)) && !/[。；;，,]/u.test(line)) return headingWords(line) || undefined;
  return undefined;
}

/** Where a quote starts in its message: as given, else by its first characters with whitespace ignored. */
function quoteStart(content: string, quote: string): number {
  const direct = content.indexOf(quote.trim().slice(0, 80));
  if (direct >= 0) return direct;
  const head = quote.replace(/\s+/gu, "").slice(0, 30);
  if (head.length < 6) return -1;
  const positions: number[] = [];
  let bare = "";
  for (let index = 0; index < content.length; index++) if (!/\s/u.test(content[index])) { bare += content[index]; positions.push(index); }
  const at = bare.indexOf(head);
  return at < 0 ? -1 : positions[at];
}

/** The heading a quote stands under in its message ("首页 Header" over "Header 高度：约 56~64px"): a heading the quote
 * opens with, else the nearest one above it. A size or rule told without it reads as the whole product's. */
export function messageSection(content: string, quote: string): string | undefined {
  const start = quoteStart(content, quote);
  if (start < 0) return undefined;
  const quoteLines = content.slice(start).split("\n");
  // Headings the quote itself opens with, before its first line of content.
  let lead: string | undefined;
  for (let index = 0, seen = 0; index < quoteLines.length && seen < 6; index++) {
    const line = quoteLines[index];
    if (!line.trim() || SEPARATOR.test(line)) continue;
    seen++;
    const label = line.match(TITLE_LABEL);
    if (label) { const value = label[1].trim() || quoteLines.slice(index + 1).find(next => next.trim())?.trim(); if (value && value.length <= MAX_HEADING) lead = headingWords(value); break; }
    const heading = headingAt(quoteLines, index);
    if (!heading) break;
    lead = heading;
  }
  if (lead) return lead;
  const before = content.slice(0, start).split("\n");
  for (let index = before.length - 1; index >= 0; index--) {
    const heading = headingAt(before, index);
    if (heading) return heading;
  }
  return undefined;
}

/** The ledger with each unit's evidence given the heading its quote stands under in its message. A unit whose message is
 * not given keeps what it had; one whose statement already names the heading needs none. */
export function withWikiSections(ledger: WikiKnowledgeLedger, messages: WikiSectionMessage[]): WikiKnowledgeLedger {
  if (!messages.length) return ledger;
  const byId = new Map(messages.map(message => [message.id, message]));
  const byIndex = new Map(messages.map(message => [`${message.conversationId}:${message.messageIndex}`, message]));
  let changed = false;
  const sectioned = (unit: WikiKnowledgeUnit): WikiKnowledgeUnit => {
    const message = byId.get(unit.evidence.messageId) ?? byIndex.get(`${unit.evidence.conversationId}:${unit.evidence.messageIndex}`);
    if (!message) return unit;
    return withCode(withSection(unit, message), message);
  };
  // The code block the quote stands in or introduces, shown as written after the paragraph citing it.
  const withCode = (unit: WikiKnowledgeUnit, message: WikiSectionMessage): WikiKnowledgeUnit => {
    const code = messageCode(message.content, unit.evidence.quote), had = unit.evidence.code;
    if (code ? had?.language === code.language && had.text === code.text : !had) return unit;
    changed = true;
    if (code) return { ...unit, evidence: { ...unit.evidence, code } };
    const { code: _dropped, ...evidence } = unit.evidence;
    void _dropped;
    return { ...unit, evidence };
  };
  const withSection = (unit: WikiKnowledgeUnit, message: WikiSectionMessage): WikiKnowledgeUnit => {
    const section = messageSection(message.content, unit.evidence.quote);
    const bare = (text: string) => text.replace(/\s+/gu, "").toLowerCase();
    const named = section && bare(unit.statement).includes(bare(section));
    if (!section || named) {
      if (!unit.evidence.section) return unit;
      changed = true;
      const { section: _dropped, ...evidence } = unit.evidence;
      void _dropped;
      return { ...unit, evidence };
    }
    if (unit.evidence.section === section) return unit;
    changed = true;
    return { ...unit, evidence: { ...unit.evidence, section } };
  };
  const batches = ledger.batches.map(batch => ({ ...batch, units: batch.units.map(sectioned) }));
  return changed ? { ...ledger, batches } : ledger;
}

/** Conversation ids a ledger's units come from. */
export const wikiLedgerConversations = (ledger: WikiKnowledgeLedger) => [...new Set(wikiLedgerUnits(ledger).map(unit => unit.evidence.conversationId))];
