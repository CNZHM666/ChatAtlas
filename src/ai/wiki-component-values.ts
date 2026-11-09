import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";

/** A global rule for one visual property (全局圆角 6–8px) and the parts that give that property a value outside it
 * (Composer border-radius 20–26px). Told apart, they read as two rules contradicting each other; the writer states the
 * parts as the rule's exceptions. */
const PROPERTIES: Array<[string, RegExp]> = [
  ["圆角", /圆角|border-radius|\bradius\b/iu],
  ["字号", /字号|font-size/iu],
];
const GLOBAL = /全局|统一|所有(?:页面|组件|元素)|整体/u;
const VALUE = /(\d+(?:\.\d+)?)\s*(?:px)?\s*(?:[~～\-–—至到]\s*(\d+(?:\.\d+)?))?\s*px/iu;

/** The value range a statement gives a property, read from the first value after the property's name. */
function rangeAfter(statement: string, property: RegExp): [number, number] | undefined {
  return valueAfter(statement, property)?.range;
}

/** The first mention of the property that gives a value in its own clause (圆角极轻边框 gives none; border-radius 20~26px does). */
function valueAfter(statement: string, property: RegExp): { range: [number, number]; text: string } | undefined {
  for (const mention of statement.matchAll(new RegExp(property.source, "giu"))) {
    const clause = statement.slice(mention.index).match(/^[^，,；;。]*/u)![0];
    const value = clause.slice(0, 40).match(VALUE);
    if (!value) continue;
    const lo = Number(value[1]), hi = Number(value[2] ?? value[1]);
    return { range: [Math.min(lo, hi), Math.max(lo, hi)], text: clause.slice(0, value.index! + value[0].length) };
  }
  return undefined;
}

const NAMES_EXCEPTION = /例外|除外|另有|以外|except/iu, OPEN_RELATION = /未明确|未定|待确认|待核实|not settled|unsettled/iu;
/** The writer settling the relation the discussion left open: "……为组件例外". */
const ASSERTED_EXCEPTION = /(?:均?为|属于|作为|视为|算作|是)(?:各|这些)?(?:组件|局部|特定组件)?例外/u;

/** A global rule's line, as the discussion leaves it: the parts that set its property otherwise are named, from their
 * own statements, and whether they are exceptions or a later rule stays open. The writer left them out, or wrote them
 * as settled exceptions ("……为组件例外"), which no unit says. The line's claims cite the parts too. Returns how many
 * lines changed. */
export function notePartExceptions(paragraphs: Array<{ text: string; unitIds: string[]; claims?: Array<{ text: string; unitIds: string[] }> }>, units: Map<string, WikiKnowledgeUnit>, parts: Map<string, WikiPartValue[]>, locale = "zh-CN"): number {
  let noted = 0;
  const english = /^en/iu.test(locale), open = english ? " (whether these are exceptions or a later rule was not settled)" : "（是组件例外还是后来的规范，讨论中未明确）";
  for (const paragraph of paragraphs) for (const id of [...paragraph.unitIds]) {
    const rule = units.get(id), others = parts.get(id);
    if (!rule || !others?.length) continue;
    const property = PROPERTIES.find(([, pattern]) => rangeAfter(rule.statement, pattern))?.[1], range = property && rangeAfter(rule.statement, property);
    if (!property || !range) continue;
    const lines = paragraph.text.split("\n"), at = lines.findIndex(line => property.test(line) && range.every(value => line.includes(String(value))));
    if (at < 0 || OPEN_RELATION.test(lines[at])) continue;
    const before = lines[at], end = before.match(/[。.；;]\s*$/u)?.[0] ?? "", body = before.slice(0, before.length - end.length);
    const settled = ASSERTED_EXCEPTION.test(body) && !others.some(part => /例外/u.test(units.get(part.id)?.statement ?? ""));
    if (NAMES_EXCEPTION.test(body) && !settled) continue;
    const list = others.map(part => part.text.replace("：", " ")).join(english ? "; " : "；");
    lines[at] = settled ? `${body.replace(ASSERTED_EXCEPTION, english ? "set it otherwise" : "另有取值")}${open}${end}` : `${body}${english ? ` (parts set it otherwise: ${list}; whether these are exceptions or a later rule was not settled)` : `（以下组件另有取值：${list}；是组件例外还是后来的规范，讨论中未明确）`}${end}`;
    paragraph.text = lines.join("\n");
    // A claim that ran to the line's end now ends before the note; the line's claims cite the parts it names.
    const ids = others.map(part => part.id);
    paragraph.claims = paragraph.claims?.map(claim => {
      const trimmed = claim.text.replace(/[。.；;]\s*$/u, "");
      const text = paragraph.text.includes(claim.text) ? claim.text : paragraph.text.includes(trimmed) ? trimmed : before.includes(trimmed) ? lines[at].replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\*\*[^*\n]+\*\*[：:]\s*)?/u, "") : claim.text;
      return lines[at].includes(text) ? { text, unitIds: [...new Set([...claim.unitIds, ...ids])] } : { ...claim, text };
    });
    paragraph.unitIds = [...new Set([...paragraph.unitIds, ...ids])];
    noted++;
  }
  return noted;
}

/** A part giving a global rule's property another value: its unit, and "part：value" from its statement. */
export interface WikiPartValue { id: string; text: string }

/** Global rule unit id → the parts outside it. */
export function componentParts(units: WikiKnowledgeUnit[]): Map<string, WikiPartValue[]> {
  const found = new Map<string, WikiPartValue[]>();
  for (const [, property] of PROPERTIES) {
    const rules = units.flatMap(unit => {
      const range = GLOBAL.test(unit.statement) ? rangeAfter(unit.statement, property) : undefined;
      return range ? [{ unit, range }] : [];
    });
    for (const { unit: rule, range: [lo, hi] } of rules) {
      const parts = units.flatMap(unit => {
        if (unit === rule || GLOBAL.test(unit.statement)) return [];
        const value = valueAfter(unit.statement, property);
        if (!value || value.range[0] >= lo && value.range[1] <= hi) return [];
        return [{ id: unit.id, text: `${unit.subject}：${value.text}` }];
      });
      if (parts.length) found.set(rule.id, [...new Map([...(found.get(rule.id) ?? []), ...parts].map(part => [part.text, part])).values()].slice(0, 4));
    }
  }
  return found;
}

/** Global rule unit id → the parts outside it, as "part：value". */
export function componentExceptions(units: WikiKnowledgeUnit[]): Map<string, string[]> {
  return new Map([...componentParts(units)].map(([id, parts]) => [id, parts.map(part => part.text)]));
}

/** A sentence saying the parts' values were left open ("这些差异是组件例外还是后来的规范，讨论中未明确。") in a paragraph
 * that no longer names any part's value: the sentence listing them was dropped by a later check, and one run kept only
 * "全局圆角统一控制在6px~8px……。这些差异是组件例外还是后来的规范，讨论中未明确。". Returns how many went. */
const OPEN_NOTE = /(?:这些|上述|以上|这类)(?:差异|取值|不同取值|例外)[^。！？\n]*(?:未明确|未定|待确认)[^。！？\n]*[。！？]?/gu;
const NAMES_PARTS = /另有取值|以下组件|例外|除外|以外/u;
export function droppedOrphanPartNotes(chapters: Array<{ body: string; paragraphs: Array<{ text: string }> }>): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const before = paragraph.text;
    const text = before.replace(OPEN_NOTE, (note, at: number) => NAMES_PARTS.test(before.slice(0, at)) ? note : "").replace(/[ \t]+$/gmu, "").trim();
    if (text === before.trim() || !text) continue;
    chapter.body = replaceParagraph(chapter.body, before, text);
    paragraph.text = text;
    dropped++;
  }
  return dropped;
}
