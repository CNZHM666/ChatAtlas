import type { WikiDraftChapter, WikiKnowledgeUnit } from "./wiki-knowledge";
import { wikiSaidWhen } from "./wiki-section-status";

/** A count of daily users and its value: "日活稳定在22人", "DAU 约40", "每天稳定在22人". */
/** Or the value first: "约30日活规模". */
const DAILY = /(?:日活(?:用户数?)?|DAU|每天)[^，。；;,\d]{0,10}?(\d+(?:\.\d+)?)|(?<![\d.])(\d+(?:\.\d+)?)\s*(?:人\s*)?(?:左右\s*)?(?:的\s*)?(?:日活|DAU)(?!用户数?[^，。；;,]{0,4}\d)/giu;
/** Words claiming the value holds today. */
const NOW = /当前|目前|现在/u;
/** A value said as a target or a condition, not measured: "目标DAU 50", "达到日活稳定超100". */
const NOT_MEASURED = /目标|达到|超过|突破|稳定超|以上|计划|预计|若|如果/u;
const MEASURED_KINDS: Array<WikiKnowledgeUnit["kind"]> = ["fact", "report", "history"];

/** The counts a text measures: each with no target or condition just before it or in it. */
const counts = (text: string) => [...text.matchAll(DAILY)].filter(match => !NOT_MEASURED.test(`${text.slice(Math.max(0, (match.index ?? 0) - 6), match.index)}${match[0]}`));
const valueOf = (match: RegExpMatchArray) => match[1] ?? match[2];
const valuesOf = (text: string) => counts(text).map(valueOf);
/** A count told as today's in a point of another kind: "鉴于当前约30日活规模数据稀疏，第一版不训练……", a decision's reason. */
const toldAsNow = (text: string) => counts(text).some(match => NOW.test(text.slice(Math.max(0, (match.index ?? 0) - 8), match.index)));
const measured = (unit: WikiKnowledgeUnit | undefined): unit is WikiKnowledgeUnit => Boolean(unit) && !unit!.about && valuesOf(unit!.statement).length > 0 && (MEASURED_KINDS.includes(unit!.kind) || toldAsNow(unit!.statement));

/** Daily-user counts said at different times, each told with when it was said: 22, 25, 30, 32 and 40 stood in five
 * chapters, each "当前", and read as five counts of today. Only when the document gives two values or more; the value
 * gets the day (or days) of its conversation, and its "当前" becomes "当时". Tables and source blocks stay as written. */
export function datedMeasures(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined, zh: boolean): number {
  if (!zh) return 0;
  const cited = [...new Set(chapters.flatMap(chapter => chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)))].map(unitOf).filter(measured);
  if (new Set(cited.flatMap(unit => valuesOf(unit.statement))).size < 2) return 0;
  let dated = 0;
  // The latest count keeps its 当前: it is the one that holds today. 「当前小程序日活约40」, said last, read 「当时……约40（8月18日）」
  // beside counts of June.
  // Only among the figures the user gave on two days or more; another's figure, an AI's reason, is dated as before.
  const saidAt = (unit: WikiKnowledgeUnit) => unit.evidence.conversationSpan?.start ?? 0, own = (unit: WikiKnowledgeUnit) => unit.evidence.role === "user" && !unit.evidence.pasted;
  const days = new Set(cited.filter(own).map(saidAt).filter(Boolean)), newest = days.size >= 2 ? Math.max(...days) : 0;
  const latest = (unit: WikiKnowledgeUnit) => newest > 0 && own(unit) && saidAt(unit) === newest;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (/^\s*(?:\||\*[^*\n]+\*\n\n|`{3,}|~{3,})/u.test(paragraph.text)) continue;
    let text = paragraph.text;
    for (const unit of paragraph.unitIds.map(unitOf).filter(measured)) {
      const when = wikiSaidWhen(unit, true);
      if (!when) continue;
      for (const value of valuesOf(unit.statement)) {
        // The sentence telling this value, not yet dated: no day right after it.
        const undated = (sentence: string) => counts(sentence).find(match => valueOf(match) === value && !/^\s*(?:人|个)?(?:左右)?（\d+月/u.test(sentence.slice((match.index ?? 0) + match[0].length)));
        const sentences = text.split(/(?<=[。！？；\n])/u), at = sentences.findIndex(sentence => undated(sentence));
        if (at < 0) continue;
        const sentence = sentences[at], valueAt = undated(sentence)!;
        const end = (valueAt.index ?? 0) + valueAt[0].length, tail = sentence.slice(end).match(/^\s*(?:人|个)?(?:左右)?/u)![0];
        // The changed stretch: from its clause's "当前" (or the count) to the value's end, so a claim holding it changes alike.
        const cut = end + tail.length, clause = Math.max(...["，", ",", "；", "、"].map(mark => sentence.lastIndexOf(mark, valueAt.index ?? 0))) + 1;
        const now = sentence.slice(clause, valueAt.index).search(NOW), from = now >= 0 ? clause + now : valueAt.index ?? 0;
        // A bracket right after the value takes the day first: "22人（6月14日；其中15个为稳定用户）", not two brackets.
        // A bracket opening on a time of its own ("约30人（近期降至22人）") is later than the day: 「（6月14日—7月7日；近期降至22人）」
        // read the two together. Its time word says so: 「（6月14日—7月7日；其后降至22人）」.
        const opens = sentence.slice(cut).startsWith("（"), recent = opens ? sentence.slice(cut + 1).match(/^(?:近期|最近|近来|后来)/u)?.[0] ?? "" : "", to = cut + (opens ? 1 + recent.length : 0);
        const old = sentence.slice(from, to), changed = `${latest(unit) ? sentence.slice(from, cut) : sentence.slice(from, cut).replace(NOW, "当时")}（${when}${opens ? `；${recent ? "其后" : ""}` : "）"}`;
        sentences[at] = `${sentence.slice(0, from)}${changed}${sentence.slice(to)}`;
        for (const claim of paragraph.claims ?? []) if (claim.text.includes(old)) claim.text = claim.text.replace(old, () => changed);
        text = sentences.join(""); dated++;
      }
    }
    if (text === paragraph.text) continue;
    chapter.body = chapter.body.replace(paragraph.text, () => text);
    paragraph.text = text;
  }
  return dated;
}
