import type { WikiDraftChapter, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";

/** A numbered part of a plan: "Milestone 3", "Phase 2", "M1", "阶段 2", "第2阶段". */
const ORDINAL = /^(?:(milestone|phase|stage|step|sprint|release|m|p)\s*-?\s*(\d{1,2})|(阶段|里程碑|步骤)\s*(\d{1,2})|第\s*(\d{1,2})\s*(阶段|步|个里程碑))\b/iu;
const KIND: Record<string, string> = { m: "milestone", p: "phase", 里程碑: "milestone", 个里程碑: "milestone", 阶段: "phase", 步: "step", 步骤: "step" };
export function ordinal(text: string | undefined): { kind: string; number: number } | undefined {
  const hit = text?.trim().match(ORDINAL);
  if (!hit) return undefined;
  const word = (hit[1] ?? hit[3] ?? hit[6]).toLowerCase(), number = Number(hit[2] ?? hit[4] ?? hit[5]);
  return { kind: KIND[word] ?? (word === "stage" ? "phase" : word), number };
}
const ITEM = /^(\s*(?:[-*+]|\d+\.)\s+\*\*)([^*\n]+)(\*\*\s*[：:]\s*)(.*)$/u;

/** A list item labelled with a numbered part ("1. **Milestone 1**: Validate with 10–15 college students …") whose
 * units all come from another part of that kind (their topic or source heading: "Milestone 3 — Private alpha"):
 * the writer numbered the items by position, the statements having lost their part. It takes its units' number. A
 * list whose items then stand out of order is sorted by number, an item without one staying after the one before
 * it, and items of one number are joined. Returns how many labels changed. */
export function ordinalLabelledItems(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined): number {
  let changed = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const lines = paragraph.text.split("\n");
    if (lines.filter(line => ITEM.test(line)).length < 2) continue;
    let relabelled = false;
    const items = lines.map(line => {
      const hit = line.match(ITEM);
      if (!hit) return { line, key: undefined as number | undefined };
      const label = hit[2].trim(), own = ordinal(label);
      if (!own) return { line, key: undefined };
      const ids = (paragraph.claims ?? []).filter(claim => claim.text.length >= 8 && line.includes(claim.text)).flatMap(claim => claim.unitIds);
      const parts = ids.map(id => { const unit = unitOf(id); return ordinal(unit?.subject) ?? ordinal(unit?.evidence.section); });
      const numbers = new Set(parts.flatMap(part => part?.kind === own.kind ? [part.number] : []));
      // Every cited unit must name its part, all the same one: a unit without one may be the label's own.
      if (!ids.length || parts.some(part => part?.kind !== own.kind) || numbers.size !== 1) return { line, key: own.number };
      const number = [...numbers][0];
      if (number === own.number) return { line, key: number };
      relabelled = true; changed++;
      return { line: `${hit[1]}${label.replace(/\d{1,2}/u, String(number))}${hit[3]}${hit[4]}`, key: number };
    });
    if (!relabelled) continue;
    // Sorted only when every item of the list is a labelled one: the run is a list of parts.
    const listed = items.filter(item => /^\s*(?:[-*+]|\d+\.)\s+/u.test(item.line));
    let next = items.map(item => item.line);
    if (listed.length === items.length && listed.every(item => ITEM.test(item.line))) {
      let last = 0;
      const keyed = items.map((item, index) => { const key = item.key ?? last + .5; last = Math.floor(key); return { ...item, key, index }; });
      keyed.sort((a, b) => a.key - b.key || a.index - b.index);
      const joined: string[] = [];
      for (const [index, item] of keyed.entries()) {
        const label = item.line.match(ITEM)![2].trim(), before = keyed[index - 1];
        if (before && before.key === item.key && before.line.match(ITEM)![2].trim() === label) { joined[joined.length - 1] += ` ${item.line.match(ITEM)![4].trim()}`; continue; }
        joined.push(item.line);
      }
      let at = 0;
      next = joined.map(line => /^\s*\d+\.\s/u.test(line) ? line.replace(/^(\s*)\d+\./u, (_, space: string) => `${space}${++at}.`) : line);
    }
    const text = next.join("\n");
    if (text === paragraph.text) continue;
    chapter.body = replaceParagraph(chapter.body, paragraph.text, () => text);
    paragraph.text = text;
  }
  return changed;
}
