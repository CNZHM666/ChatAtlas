import type { WikiDraftChapter, WikiKnowledgeUnit } from "./wiki-knowledge";
import { wikiSaidLater } from "./wiki-sources";

/** A path of three or more steps, joined by one kind of arrow or dash: "选择目标→设置高风险时间→开启挑战". */
const STEP_PATH = /[^\s，。；、,;：:“”"（）()→\-—>]{2,14}(?:\s*(?:→|->|—|-)\s*[^\s，。；、,;：:“”"（）()→\-—>]{2,14}){2,}/gu;
const stepsOf = (path: string) => path.split(/\s*(?:→|->|—|-)\s*/u).map(step => step.trim()).filter(Boolean);
/** Two steps are one when either holds the other ("打卡", "完成首次打卡"). */
const sameStep = (a: string, b: string) => a.includes(b) || b.includes(a);
const sharedSteps = (a: string[], b: string[]) => a.filter(step => b.some(other => sameStep(step, other))).length;
/** Steps two paths share, at least, to be two versions of one path. */
const SAME_PATH = 2;

/** One sentence telling two versions of one path ("……路径为选择目标→设置高风险时间→……→获得即时反馈，需强制引导完成“选择目标-
 * 高危时间-生成计划-打卡-加入小组”闭环……"): the writer joined two points restating each other, and the 30-second path
 * read twice. The clause holding the earlier point's path goes; the later one's stays. Only when each path is found in
 * one cited point's statement and the two points were said at different times. */
export function droppedEarlierPaths(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (/^\s*(?:\||\*[^*\n]+\*\n\n|`{3,}|~{3,})/u.test(paragraph.text)) continue;
    const units = paragraph.unitIds.map(unitOf).filter((unit): unit is WikiKnowledgeUnit => Boolean(unit));
    const ownerOf = (steps: string[]) => units.find(unit => { const theirs = (unit.statement.match(STEP_PATH) ?? []).map(stepsOf); return theirs.some(other => sharedSteps(steps, other) >= steps.length - 1 && other.length >= steps.length - 1); });
    let text = paragraph.text;
    for (const sentence of text.split(/(?<=[。！？\n])/u)) {
      const clauses = sentence.split(/(?<=[，,；;])/u), paths = clauses.map(clause => (clause.match(STEP_PATH) ?? []).map(stepsOf).find(steps => steps.length >= 3 && steps.every(step => /\p{L}/u.test(step))));
      let done = false;
      for (let first = 0; first < clauses.length && !done; first++) for (let second = first + 1; second < clauses.length && !done; second++) {
        const a = paths[first], b = paths[second];
        if (!a || !b || sharedSteps(a, b) < SAME_PATH) continue;
        const ownA = ownerOf(a), ownB = ownerOf(b);
        if (!ownA || !ownB || ownA === ownB) continue;
        const earlier = wikiSaidLater(ownB, ownA) ? first : wikiSaidLater(ownA, ownB) ? second : -1;
        if (earlier < 0) continue;
        const kept = clauses.filter((_, at) => at !== earlier);
        // The sentence keeps its end: dropping its last clause leaves the one before ending on a comma.
        const end = sentence.trimEnd().match(/[。！？!?]$/u)?.[0] ?? "";
        let next = kept.join("");
        if (earlier === clauses.length - 1) next = next.replace(/[，,；;\s]+$/u, "") + end + sentence.slice(sentence.trimEnd().length);
        const old = clauses[earlier];
        text = text.replace(sentence, () => next);
        for (const claim of paragraph.claims ?? []) if (claim.text.includes(old)) claim.text = claim.text.replace(old, "").replace(/[，,；;\s]+$/u, "");
        dropped++; done = true;
      }
    }
    if (text === paragraph.text) continue;
    chapter.body = chapter.body.replace(paragraph.text, () => text);
    paragraph.text = text;
  }
  return dropped;
}
