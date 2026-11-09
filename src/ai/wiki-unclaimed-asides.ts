import { type WikiDraftChapter, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";
import { wikiSaidLater } from "../shared/wiki-sources";

/** Status talk no unit states: whether a plan still holds, was replaced or still needs answering. The document's own
 * marks (〔此前〕, 〔未定〕) say that from the checked relations. One run wrote "这一布局已被后续更紧凑的设计取代" and
 * "现行规范可能已调整" after an earlier plan, and "具体实现细节仍需进一步澄清" for a unit whose only detail was the code
 * NEEDS_CLARIFICATION. */
const STATUS_ASIDE = /已被[^。！？!?]{0,16}(?:取代|替代|替换)|不再作为|历史版本|可能已(?:经)?(?:调整|变化|更新|改变)|现行规范|仍(?:需|待)(?:进一步)?(?:澄清|确认|讨论|明确)|有待(?:进一步)?(?:澄清|确认|讨论|明确)/u;

const bare = (text: string) => text.replace(/[\s*`“”"「」]/gu, "");
const sentencesOf = (text: string) => text.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u);

/** Drop a sentence of a written paragraph that no claim of it covers and that only tells a status. A paragraph with no
 * claims is left as it is: nothing tells which of its sentences a unit gives. */
export function droppedStatusAsides(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const claims = (paragraph.claims ?? []).map(claim => bare(claim.text)).filter(text => text.length >= 4);
    if (!claims.length || /^\s*\|/u.test(paragraph.text)) continue;
    const before = paragraph.text;
    const text = before.split("\n").map(line => {
      const parts = sentencesOf(line);
      if (parts.length < 2) return line;
      return parts.filter(sentence => {
        const own = bare(sentence);
        if (!STATUS_ASIDE.test(sentence) || own.length < 4) return true;
        return claims.some(claim => claim.includes(own.replace(/[。！？!?]$/u, "")) || own.includes(claim.replace(/[。！？!?]$/u, "")));
      }).join("");
    }).join("\n");
    if (text === before || !text.trim()) continue;
    chapter.body = replaceParagraph(chapter.body, before, text);
    paragraph.text = text; dropped++;
  }
  return dropped;
}

/** A clause telling what replaced an earlier version ("现已替换为上述浅色规范", "该方案已被当前的极简设计取代"): the
 * 〔此前〕 mark says it was replaced, and the writer named the replacement itself. One run wrote that the dark palette
 * was replaced by the light one, next to a rule that every page must support dark mode; the source had only a newer
 * dark palette. */
const REPLACED_CLAUSE = /^(?:该|此|这一?)?(?:方案|设计|规范|布局|配色|版本)?(?:现|目前|当前|后来|后续)?(?:已经?|均已)?(?:被[^，,；;。]{1,24})?(?:替换|取代|替代)(?:为[^，,；;。]{1,24})?[。！？!?]?$/u;
const withoutReplacedClauses = (text: string) => text.replace(/[，,；;]\s*([^，,；;。！？!?\n]+)([。！？!?]|$)/gu, (whole, clause: string, end: string) => REPLACED_CLAUSE.test(clause.trim()) ? end : whole);

/** Drop such a clause from the sentences of a paragraph citing an earlier version, in its text and its claims. Returns
 * how many paragraphs changed. */
export function droppedReplacedClauses(chapters: WikiDraftChapter[], statuses: Map<string, WikiUnitStatus>): number {
  let changed = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (/^\s*\|/u.test(paragraph.text) || !paragraph.unitIds.some(id => statuses.get(id) === "history")) continue;
    const before = paragraph.text, text = withoutReplacedClauses(before);
    if (text === before || !text.trim()) continue;
    chapter.body = replaceParagraph(chapter.body, before, text);
    paragraph.text = text;
    paragraph.claims = paragraph.claims?.map(claim => { const own = withoutReplacedClauses(claim.text); return own !== claim.text && text.includes(own) ? { ...claim, text: own } : claim; });
    changed++;
  }
  return changed;
}

/** A storage default inside a sentence (", 默认仅保存在当前浏览器会话中"), and one anywhere in a sentence. */
const DEFAULT_INSIDE = /[，,；;]\s*(默认[^，,；;。！？!?\n]*?(?:保存|存储|存放|存在|写入)[^，,；;。！？!?\n]*)/u;
const DEFAULT_ANY = /默认[^，,；;。！？!?\n]*?(?:保存|存储|存放|存在|写入)[^，,；;。！？!?\n]*/u;
/** Drop a storage default from a sentence when another line of the same paragraph gives another default from a later
 * message, in this conversation or one held after it (a unit the paragraph cites states it). One run marked "采用 BYOK 模式，默认仅保存在
 * 当前浏览器会话中" as decided (the user had said only "我想让用户自己接api") right above "默认将 API Key 仅保存在运行时
 * 内存", the later design. Returns how many paragraphs changed. */
/** trimmed: gets the units whose sentence lost its default, so the decision check does not write the old one back. */
export function droppedOverriddenDefaults(chapters: WikiDraftChapter[], unitOf: (unitId: string) => WikiKnowledgeUnit | undefined, trimmed?: Set<string>): number {
  let changed = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const claims = paragraph.claims ?? [];
    if (!claims.length || /^\s*\|/u.test(paragraph.text)) continue;
    let text = paragraph.text, next = claims;
    for (const older of claims) {
      const hit = older.text.match(DEFAULT_INSIDE), places = older.unitIds.map(unitOf);
      if (!hit || !places.length || places.some(place => !place)) continue;
      const newer = text.split(/\n|(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).some(line => {
        const own = bare(line).includes(bare(older.text)) ? undefined : line.match(DEFAULT_ANY)?.[0];
        if (!own || bare(own) === bare(hit[1])) return false;
        return paragraph.unitIds.some(id => {
          const unit = unitOf(id);
          return Boolean(unit && !older.unitIds.includes(id) && bare(unit.statement).includes(bare(own)) && places.every(place => wikiSaidLater(unit, place!)));
        });
      });
      const own = older.text.replace(hit[0], "");
      if (!newer || !text.includes(older.text) || bare(own).length < 6) continue;
      text = text.replace(older.text, own);
      next = next.map(claim => claim === older ? { ...claim, text: own } : claim);
      for (const id of older.unitIds) trimmed?.add(id);
    }
    if (text === paragraph.text) continue;
    chapter.body = replaceParagraph(chapter.body, paragraph.text, text);
    paragraph.text = text; paragraph.claims = next; changed++;
  }
  return changed;
}

const cellsOf = (table: string) => table.split("\n").slice(2).flatMap(row => row.split("|").map(cell => cell.trim()).filter(Boolean));

/** A table the writer made of what another paragraph of the chapter already says, cell by cell ("| AI | 理解 |" right
 * after "AI 负责理解，程序负责执行，Validator 负责否决"): it tells it a second time, and one run left Validator out of it. */
export function droppedEchoTables(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) {
    chapter.paragraphs = chapter.paragraphs.filter(paragraph => {
      const lines = paragraph.text.trim().split("\n");
      if (lines.length < 3 || !lines.every(line => /^\s*\|.*\|\s*$/u.test(line)) || !/^\s*\|[\s:|-]+\|\s*$/u.test(lines[1])) return true;
      const cells = cellsOf(paragraph.text.trim());
      const others = chapter.paragraphs.filter(other => other !== paragraph && other.unitIds.some(id => paragraph.unitIds.includes(id)));
      if (!cells.length || !paragraph.unitIds.length || !paragraph.unitIds.every(id => others.some(other => other.unitIds.includes(id)))) return true;
      const said = bare(others.map(other => other.text).join("\n")).toLowerCase();
      if (!cells.every(cell => said.includes(bare(cell).toLowerCase()))) return true;
      chapter.body = replaceParagraph(chapter.body, paragraph.text, "").replace(/\n{3,}/gu, "\n\n").trimEnd();
      dropped++;
      return false;
    });
  }
  return dropped;
}
