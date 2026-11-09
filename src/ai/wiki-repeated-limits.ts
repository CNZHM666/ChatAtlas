import { LEAVES_OUT } from "../shared/negation";
import type { WikiDraftChapter, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";

/** A clause leaving something out for now: "本阶段不包含比价", "暂不实现实时比价、PCB 设计或复杂仿真". */
const LIMIT = new RegExp(String.raw`(?:本阶段|当前|第一版|V0\.1|前期|现阶段|此阶段)?[^，,。；;（(]{0,6}?${LEAVES_OUT}\s*([^，,。；;）)]{2,40})`, "u");
const NEGATED = /不|暂不|禁止|无需|没有|严禁/u;

/** What a limit leaves out, as short items: "商城比价功能" → 比价; "实时比价、PCB 设计或复杂仿真" → 比价, PCB设计, 复杂仿真. */
export function limitItems(clause: string): string[] {
  const body = clause.match(LIMIT)?.[1] ?? "";
  return body.split(/[、/，,]|或|以及|及|和|与/u).map(part => part.replace(/\s+/gu, "").replace(/^(?:实时|全网|在线|商品|商城|任何)+/u, "").replace(/(?:功能|系统|信息)$/u, "")).filter(part => part.length >= 2);
}

/** A sentence that is a limit alone ("本阶段不包含比价。") which none of the units it cites says: one run wrote it after
 * the user's wish "提供比价推荐及链接", citing that wish, beside the limit the chapter told from its own units. */
export function droppedUnsourcedLimits(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined): number {
  let dropped = 0;
  const says = (unit: WikiKnowledgeUnit, item: string) => {
    const text = unit.statement.replace(/\s+/gu, ""), at = text.indexOf(item);
    return at >= 0 && NEGATED.test(text.slice(Math.max(0, at - 14), at));
  };
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const sentences = paragraph.text.split(/(?:(?<=[。！？!?\n])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u);
    const kept = sentences.filter(sentence => {
      const trimmed = sentence.trim();
      const whole = trimmed.match(LIMIT);
      if (!whole || whole.index !== 0 || trimmed.length > whole[0].length + 2 || trimmed.startsWith("|") || /^[-*+]|^\d+\./u.test(trimmed)) return true;
      const items = limitItems(trimmed);
      const cited = (paragraph.claims ?? []).filter(claim => claim.text.trim() === trimmed || trimmed.includes(claim.text.trim())).flatMap(claim => claim.unitIds);
      const units = (cited.length ? cited : paragraph.unitIds).flatMap(id => unitOf(id) ?? []);
      return !items.length || units.some(unit => items.some(item => says(unit, item)));
    });
    if (kept.length === sentences.length || !kept.join("").trim()) continue;
    const text = kept.join("").replace(/\n{3,}/gu, "\n\n").trim();
    chapter.body = replaceParagraph(chapter.body, paragraph.text, text);
    paragraph.claims = paragraph.claims?.filter(claim => text.includes(claim.text));
    paragraph.text = text;
    dropped++;
  }
  return dropped;
}

/** A limit closing a chapter's opening that an earlier chapter's opening already gives ("……文案面向小白用户避免技术术语，
 * 本阶段不包含商城比价功能。" after 核心工作流's "（本阶段暂不包含比价）"): one limit was told in three openings, two of
 * chapters about other things. The clause goes; a limit adding an item of its own stays. Returns how many went. */
export function droppedRepeatedOpeningLimits(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  const told = new Set<string>();
  const covered = (item: string) => [...told].some(other => other.includes(item) || item.includes(other));
  for (const chapter of chapters) {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    if (!opening.trim()) continue;
    const clauses = opening.split(/(?=[，,；;])|(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u);
    const items: string[] = [];
    let changed = false;
    const kept = clauses.map(clause => {
      const hit = clause.match(LIMIT), own = hit ? limitItems(clause) : [];
      if (!hit || !own.length) return clause;
      items.push(...own);
      // Only a clause after another, and one that is the limit alone: an opening that is the limit is the chapter's own
      // subject, and a clause telling a decision with the limit beside it keeps both.
      const after = /^[，,；;]/u.test(clause), alone = clause.replace(/[，,；;。！？!?\s]/gu, "").length <= hit[0].replace(/\s/gu, "").length + 4;
      if (!after || !alone || !own.every(covered)) return clause;
      changed = true;
      // The sentence's end stays.
      return clause.match(/[。！？!?]\s*$/u)?.[0] ?? "";
    });
    items.forEach(item => told.add(item));
    if (!changed) continue;
    chapter.body = kept.join("") + chapter.body.slice(opening.length);
    dropped++;
  }
  return dropped;
}
