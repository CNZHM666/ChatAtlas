import {readWikiSources} from "./wiki-source-reading";
import {sourceQuoteProjection,sourceQuoteText} from "./source-quote-text";
import type { FocusEvidence, FocusSection } from "./focus-session";
import type { ConversationMessage } from "./types";
import type { ClaimMeaningCheck } from "./claim-meaning";

export interface WikiClaim {
  /** Optional stable claim identifier for direct state updates. */
  id?: string;
  text: string; quote: string; evidenceIds: string[]; verification?: "supported" | "uncertain";
  /** Optional raw character offsets into the primary cited message for deterministic anchoring. */
  quoteRange?: { start: number; end: number };
  /** The model meaning check the user ran on this claim, if any; a reading aid, it never edits the text. */
  meaning?: ClaimMeaningCheck;
  /** The knowledge ledger holds every unit of this claim as the user's decision (their words, or their verdict). */
  userDecided?: boolean;
  /** Who holds the sentence, from its units' statuses when the document was built: shown as a mark after it. */
  holder?: import("./wiki-holder").WikiHolder;
  /** The user answered this sentence while checking evidence: it is not asked about again. */
  checked?: boolean;
  /** The ledger units the sentence states, so switching its mark records the user's verdict on them. */
  unitIds?: string[];
  /** The last claim of a run of one holder in its paragraph: the one whose mark is labelled (the others show a dot). */
  holderMark?: boolean;
  /** A claim saved by the user's side panel update, independent of the generated ledger. */
  continuation?: true;
  /** Only places a holder mark (the end of a run of one holder): never a fact, a key conclusion or a status label. */
  markOnly?: boolean;
  /** Presentation metadata on the same grounded Wiki claim, never separate dashboard facts. */
  overviewRole?: "purpose" | "stage" | "progress" | "next" | "decision" | "scope" | "workflow" | "constraint";
  workStatus?: "reported" | "planned" | "proposed";
  /** Sourced technical context that helps explain the design in a concise Wiki. */
  technicalContext?: true;
  /** Grouping hints, never proof of adoption or implementation. */
  subject?:string;
  scope?:string;
  /** Optional links to retained facts. Original source receipts still decide
   * whether a proposed relationship can affect the current view. */
  relation?:{kind:"supplements"|"narrows"|"replaces"|"coexists"|"conflicts";targetQuote:string};
  /** Complete literal formulations in this generated article, not originals. */
  formulations?:string[];
  /** Computed from full originals locally, never accepted from model output. */
  sourceReading?:import("./wiki-source-reading").WikiSourceReading;
}

/** Keep offsets into the original text even when the model folds whitespace. */
export function wikiQuoteRange(content: string, quote: string): { start: number; end: number } | undefined {
  const needle = quote.replace(/\s+/gu, " ").trim();
  if (!needle) return undefined;
  const exact = content.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  let normalized = "";
  const starts: number[] = [], ends: number[] = [];
  for (const match of content.matchAll(/\s+|\S/gu)) {
    const at = match.index!;
    const text = /^\s/u.test(match[0]) ? " " : match[0];
    normalized += text;
    for (let i = 0; i < text.length; i++) { starts.push(at); ends.push(at + match[0].length); }
  }
  const at = normalized.indexOf(needle);
  if (at >= 0) return { start: starts[at], end: ends[at + needle.length - 1] };
  const projection=sourceQuoteProjection(content);
  if(projection)for(const text of [quote,sourceQuoteText(quote)]){
    const wanted=text.normalize("NFKC").replace(/\s/gu,"");if(wanted.length<4)continue;
    const found=projection.text.indexOf(wanted);
    if(found>=0)return{start:projection.starts[found],end:projection.ends[found+wanted.length-1]};
  }
  return looseQuoteRange(content, quote);
}

/** Characters a quote and its message may differ in without differing in words: Markdown emphasis and code marks
 * ("**AI 对话的文件管理器**"), whitespace, and full- or half-width forms of the same punctuation. */
const IGNORED = /[\s*_`~]/u;
const BLOCK_PREFIX = /^[ \t]*(?:>+[ \t]*|#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+)/gmu;
const looseChar = (char: string) => char.normalize("NFKC").toLocaleLowerCase();

function buildLooseIndex(text: string): { haystack: string; at: number[] } {
  const skipped = new Set<number>();
  for (const match of text.matchAll(BLOCK_PREFIX)) {
    const start = match.index!;
    for (let i = 0; i < match[0].length; i++) skipped.add(start + i);
  }
  let haystack = "";
  const at: number[] = [];
  let offset = 0;
  for (const char of Array.from(text)) {
    if (!skipped.has(offset) && !IGNORED.test(char)) {
      const loose = looseChar(char);
      haystack += loose;
      for (let i = 0; i < loose.length; i++) at.push(offset);
    }
    offset += char.length;
  }
  return { haystack, at };
}

function looseNeedle(text: string): string {
  return Array.from(text.replace(BLOCK_PREFIX, "")).filter(char => !IGNORED.test(char)).map(looseChar).join("");
}

function charEnd(content: string, start: number): number {
  return start + ((content.codePointAt(start) ?? 0) > 0xffff ? 2 : 1);
}

function looseQuoteRange(content: string, quote: string): { start: number; end: number } | undefined {
  const needle = looseNeedle(quote);
  if (needle.length < 4) return undefined;
  const { haystack, at } = buildLooseIndex(content);
  const found = haystack.indexOf(needle);
  if (found >= 0) {
    return { start: at[found], end: charEnd(content, at[found + needle.length - 1]) };
  }
  // Support quotes with ellipsis ("前文……后文") or minor middle omissions via head+tail dual anchoring.
  const ellipsisParts = quote.split(/(?:\.{3,}|…+)/u).map(looseNeedle).filter(part => part.length >= 6);
  const head = ellipsisParts.length >= 2 ? ellipsisParts[0].slice(0, 24) : needle.length >= 24 ? needle.slice(0, 14) : "";
  const tail = ellipsisParts.length >= 2 ? ellipsisParts.at(-1)!.slice(-24) : needle.length >= 24 ? needle.slice(-14) : "";
  if (head && tail && head !== tail) {
    const maxSpan = Math.max(needle.length * 2.5, 600);
    let searchFrom = 0;
    let best: { start: number; end: number; span: number } | undefined;
    while (searchFrom < haystack.length) {
      const headAt = haystack.indexOf(head, searchFrom);
      if (headAt < 0) break;
      const tailAt = haystack.indexOf(tail, headAt + head.length);
      if (tailAt >= 0) {
        const endIdx = tailAt + tail.length - 1;
        const start = at[headAt], end = charEnd(content, at[endIdx]);
        const span = end - start;
        if (span <= maxSpan && (!best || span < best.span)) best = { start, end, span };
      }
      searchFrom = headAt + head.length;
    }
    if (best) return { start: best.start, end: best.end };
  }
  return undefined;
}

/** Optional claim anchors survive only when the final raw message contains the quote. */
export function groundWikiClaims(sections: FocusSection[], evidence: FocusEvidence[], messages: ConversationMessage[], assessSources=false): FocusSection[] {
  return sections.map(section => {
    if (section.origin || section.userEdited) return section;
    const input = section.claims ?? [];
    const claims = input.flatMap(claim => {
    const evidenceIds = claim.evidenceIds.filter(id => section.evidenceIds.includes(id) && evidence.some(ref => ref.id === id && messages.some(message => message.conversationId === ref.conversationId && message.id === ref.messageId && wikiQuoteRange(message.content, claim.quote))));
    const grounded={...claim,evidenceIds,...(claim.formulations?{formulations:claim.formulations.filter(text=>Boolean(wikiQuoteRange(section.body,text)))}:{})};
    return evidenceIds.length ? [{ ...grounded,...(assessSources?{sourceReading:readWikiSources(grounded,evidence,messages)}:{}) }] : [];
    });
    return { ...section, ...(section.claims ? { claims } : {}), evidenceReview: { status: !claims.length ? "unanchored" as const : claims.length < input.length ? "partial" as const : "anchored" as const, invalidClaims: input.length - claims.length, checkedClaims: 0, totalClaims: input.length } };
  });
}

/** Claims per generated section; the shared wire decoder enforces the same limit. */
export const MAX_WIKI_SECTION_CLAIMS = 12;

export function validateWikiClaims(value: unknown, allowedIds: string[]): WikiClaim[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_WIKI_SECTION_CLAIMS) throw new Error("Invalid Wiki evidence");
  return value.map(item => {
    if (!item || typeof item !== "object" || typeof item.text !== "string" || !item.text.trim() || item.text.length > 400 || typeof item.quote !== "string" || !item.quote.trim() || item.quote.length > 350 || !Array.isArray(item.evidenceIds) || !item.evidenceIds.length || item.evidenceIds.some((id: unknown) => typeof id !== "string" || !allowedIds.includes(id))) throw new Error("Invalid Wiki evidence");
    const relation=item.relation;
    const link=relation&&typeof relation==="object"&&["supplements","narrows","replaces","coexists","conflicts"].includes(relation.kind)&&typeof relation.targetQuote==="string"&&relation.targetQuote.trim()&&relation.targetQuote.length<=350?{kind:relation.kind as NonNullable<WikiClaim["relation"]>["kind"],targetQuote:relation.targetQuote.trim()}:undefined;
    const formulations=Array.isArray(item.formulations)?[...new Set<string>(item.formulations.filter((text:unknown):text is string=>typeof text==="string"&&Boolean(text.trim())&&text.length<=600).slice(0,4).map((text:string)=>text.trim()))]:undefined;
    return { text: item.text.trim(), quote: item.quote.trim(), evidenceIds: [...new Set<string>(item.evidenceIds)],...(link?{relation:link}:{}),...(formulations?.length?{formulations}:{}),
      ...(["purpose", "stage", "progress", "next", "decision", "scope", "workflow", "constraint"].includes(item.overviewRole) ? { overviewRole: item.overviewRole as WikiClaim["overviewRole"] } : {}),
      ...(typeof item.subject==="string"&&item.subject.trim()&&item.subject.length<=100?{subject:item.subject.trim()}:{}),
      ...(typeof item.scope==="string"&&item.scope.trim()&&item.scope.length<=100?{scope:item.scope.trim()}:{}),
      ...(["reported", "planned", "proposed"].includes(item.workStatus) ? { workStatus: item.workStatus as WikiClaim["workStatus"] } : {}) };
  });
}
