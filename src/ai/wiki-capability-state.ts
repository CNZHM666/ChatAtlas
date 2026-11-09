import type { WikiDraftChapter, WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";
import { wikiSaidLater } from "../shared/wiki-sources";

/** What the user reports a part does not do yet (Validator 不检查电压、GPIO 冲突), beside units that describe that part
 * doing it (构建 Compatibility Engine 实时检查电压; tests 覆盖 GPIO 冲突). Told side by side as two current facts, they
 * contradict each other; the report says what holds now, and the others are plans. */
const LACKS = /([A-Za-z][\w-]{1,30}|[一-鿿]{2,8})\s*(?:当前|目前|暂时|还|尚)?(?:不|未|没有)(?:完全|全部|充分)?(?:检查|校验|验证|判断|支持|覆盖)([^。；;，,]+)/u;
const DOES = /检查|校验|验证|判断|覆盖|识别/u;
const SPLIT = /[、/，,]|以及|及|和|与|或/u, squeeze = (text: string) => text.replace(/\s+/gu, "");

interface Report { unit: WikiKnowledgeUnit; part: string; objects: string[]; text: string }
function reportsOf(units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>): Report[] {
  return units.flatMap(unit => {
    if (unit.evidence.role !== "user" && statuses.get(unit.id) !== "reported") return [];
    const match = unit.statement.match(LACKS);
    if (!match) return [];
    const objects = match[2].split(SPLIT).map(part => part.trim().replace(/^(?:是否|有无)/u, "")).filter(part => part.length >= 2);
    return objects.length ? [{ unit, part: match[1], objects: objects.map(squeeze), text: match[0].trim() }] : [];
  });
}
/** The units describing the report's part doing what it lacks: the same part (Validator) naming the object, or checking
 * the object itself (实时检查电压), not a rule that only mentions it. */
function doers(report: Report, units: WikiKnowledgeUnit[]) {
  const part = report.part.toLowerCase();
  return units.filter(unit => {
    if (unit === report.unit || !DOES.test(unit.statement) || LACKS.test(unit.statement)) return false;
    const text = squeeze(unit.statement);
    const checks = (object: string) => text.toLowerCase().includes(part) ? text.includes(object) : new RegExp(`(?:${DOES.source})[^。；;，,”"]{0,30}${object.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u").test(text);
    return report.objects.some(checks);
  });
}
/** A unit telling the part as built after the report: itself a report of what was done. A proposal said after it
 * ("Validator需逐步检查GPIO冲突……" two messages on) is still a plan, and one run told the user's report "Validator不检查电压"
 * as 此前 beside an opening listing those checks as had. */
const builtAfter = (unit: WikiKnowledgeUnit, report: WikiKnowledgeUnit, statuses: Map<string, WikiUnitStatus>) => wikiSaidLater(unit, report) && (unit.delivery === "user_reported" || ["reported", "relayed"].includes(statuses.get(unit.id) ?? ""));

/** Reports the discussion went past: a later unit builds what the report says is missing ("Validator不检查电压" at one
 * message, "实现 GPIO 冲突、电压兼容……等六类电气规则" at the next). The report is the state at that time, not now: one
 * run wrote "当前 Validator 不检查电压、GPIO 冲突" in a chapter listing those checks. report unit id → its part. */
export function outdatedCapabilityReports(units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>): Map<string, string> {
  return new Map(reportsOf(units, statuses).filter(report => doers(report, units).some(unit => builtAfter(unit, report.unit, statuses))).map(report => [report.unit.id, report.part]));
}

/** unit id → the user's report (its unit and the clause saying what is missing), for every unit describing it as a
 * capability. A report later units went past says nothing of now (outdatedCapabilityReports). */
export function currentCapabilityState(units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>): Map<string, { id: string; text: string }> {
  const found = new Map<string, { id: string; text: string }>();
  for (const report of reportsOf(units, statuses)) {
    const doing = doers(report, units);
    if (doing.some(unit => builtAfter(unit, report.unit, statuses))) continue;
    for (const unit of doing) if (!found.has(unit.id)) found.set(unit.id, { id: report.unit.id, text: report.text });
  }
  return found;
}

/** Sentences telling an outdated report's lack as the present ("当前 Validator 不检查电压……") read as before: "此前". In
 * the paragraphs citing it and in the opening, which the writer may write from it. Returns how many changed. */
export function pastCapabilityWords(chapters: WikiDraftChapter[], outdated: Map<string, string>): number {
  if (!outdated.size) return 0;
  let changed = 0;
  const past = (text: string, parts: string[]) => text.split(/(?:(?<=[。！？!?；;\n])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).map(sentence => {
    const match = sentence.match(LACKS);
    if (!match || !parts.some(part => part.toLowerCase() === match[1].toLowerCase())) return sentence;
    const at = match.index ?? 0, clauseStart = Math.max(0, ...["，", ",", "；", ";", "：", ":"].map(mark => sentence.lastIndexOf(mark, at) + 1));
    const lead = sentence.slice(clauseStart, at), own = match[0];
    if (/此前|当时|之前/u.test(lead + own)) return sentence;
    if (/当前|目前/u.test(own)) return sentence.slice(0, at) + own.replace(/当前|目前/u, "此前") + sentence.slice(at + own.length);
    if (/当前|目前/u.test(lead)) return sentence.slice(0, clauseStart) + lead.replace(/当前|目前/u, "此前") + sentence.slice(at);
    // The sentence's "now" said earlier on ("当前画布仅为架构预览，Validator 尚未完全覆盖……"): that one turns, else
    // "当前画布……，此前 Validator……" told one state two ways.
    if (/当前|目前/u.test(sentence.slice(0, clauseStart))) return sentence.replace(/当前|目前/u, "此前");
    return `${sentence.slice(0, at)}此前${/^[A-Za-z]/u.test(match[1]) ? " " : ""}${sentence.slice(at)}`;
  }).join("");
  const allParts = [...new Set(outdated.values())];
  for (const chapter of chapters) {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    const pastOpening = opening ? past(opening, allParts) : opening;
    if (pastOpening !== opening) { chapter.body = pastOpening + chapter.body.slice(opening.length); changed++; }
    for (const paragraph of chapter.paragraphs) {
      const parts = paragraph.unitIds.flatMap(id => outdated.get(id) ?? []);
      if (!parts.length) continue;
      const text = past(paragraph.text, parts);
      if (text === paragraph.text) continue;
      chapter.body = replaceParagraph(chapter.body, paragraph.text, text);
      for (const claim of paragraph.claims ?? []) { const moved = past(claim.text, parts); if (moved !== claim.text && text.includes(moved)) claim.text = moved; }
      paragraph.text = text; changed++;
    }
  }
  return changed;
}

/** Words telling a capability as planned, not had. */
const PLANNED = /计划|规划|将(?:会)?|拟|目标|设计为|预期|未来|后续|旨在|用于|\b(?:plan|will|aim)/iu;
/** The opening of a chapter whose discussion says a part does not do a check yet ("Validator 不检查电压、GPIO 冲突")
 * telling that check as had ("……规则引擎，实时检查电压、电流及 GPIO 冲突以发现常见错误", "……的同时识别电压、GPIO 及总线冲突"): the overview reads the opening,
 * and one reader took the plan for the current state. The check is told as planned ("计划实时检查……"). Returns how many
 * openings changed. */
export function plannedCapabilityWords(chapters: WikiDraftChapter[], units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>): number {
  const reports = reportsOf(units, statuses).filter(report => !doers(report, units).some(unit => builtAfter(unit, report.unit, statuses)));
  if (!reports.length) return 0;
  let changed = 0;
  for (const chapter of chapters) {
    const cited = new Set(chapter.paragraphs.flatMap(paragraph => paragraph.unitIds));
    const objects = reports.filter(report => cited.has(report.unit.id)).flatMap(report => report.objects);
    if (!objects.length) continue;
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    const told = !opening.trim() ? opening : opening.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).map(sentence => {
      if (PLANNED.test(sentence) || LACKS.test(sentence) || /尚未|还未|未(?:完全)?覆盖/u.test(sentence)) return sentence;
      const verb = [...sentence.matchAll(/(?:实时|自动)?(?:检查|校验|验证|识别)/gu)].find(match => objects.some(object => squeeze(sentence.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 30)).includes(object)));
      if (!verb) return sentence;
      const at = verb.index ?? 0;
      return `${sentence.slice(0, at)}计划${sentence.slice(at)}`;
    }).join("");
    if (told !== opening) { chapter.body = told + chapter.body.slice(opening.length); changed++; }
    // A paragraph telling the report beside the check as built ("实现确定性执行的 validateProject 函数，检查……电压兼容、
    // GPIO 冲突……。当前画布仅为架构预览；Validator 不检查电压、GPIO 冲突……"): read side by side, the two contradict
    // each other. The check is the plan.
    for (const paragraph of chapter.paragraphs) {
      const own = reports.filter(report => paragraph.unitIds.includes(report.unit.id)).flatMap(report => report.objects);
      if (!own.length) continue;
      const text = paragraph.text.split(/(?:(?<=[。！？!?\n])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).map(sentence => planned(sentence, own)).join("");
      if (text === paragraph.text) continue;
      chapter.body = replaceParagraph(chapter.body, paragraph.text, text);
      for (const claim of paragraph.claims ?? []) { const moved = planned(claim.text, own); if (moved !== claim.text && text.includes(moved)) claim.text = moved; }
      paragraph.text = text; changed++;
    }
  }
  return changed;
}
/** A sentence telling a check of the objects as had, told as planned: "计划" before the verb that starts its clause
 * (实现、新增、建立) or before the check itself. A list item's label stays first. */
function planned(sentence: string, objects: string[]): string {
  if (PLANNED.test(sentence) || LACKS.test(sentence) || /尚未|还未|未(?:完全)?覆盖|此前|当时/u.test(sentence)) return sentence;
  const verb = [...sentence.matchAll(/(?:实时|自动)?(?:检查|校验|验证|识别)/gu)].find(match => objects.some(object => squeeze(sentence.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 30)).includes(object)));
  if (!verb) return sentence;
  const at = verb.index ?? 0, clauseStart = Math.max(0, ...["，", ",", "；", ";", "。", "：", ":"].map(mark => sentence.lastIndexOf(mark, at) + 1));
  const lead = sentence.match(/^\s*(?:[-*+]\s+|\d+\.\s+)?(?:\*\*[^*\n]+\*\*[：:]\s*)?/u)?.[0] ?? "";
  // The sentence's first clause starts with building it ("实现确定性执行的 validateProject 函数，检查……"): before that.
  const builds = sentence.slice(lead.length).match(/^\s*(?:实现|新增|增加|建立|构建|提供)/u);
  if (builds) return `${sentence.slice(0, lead.length)}计划${sentence.slice(lead.length).trimStart()}`;
  const start = Math.max(clauseStart, lead.length);
  return /^\s*(?:实现|新增|增加|建立|构建)/u.test(sentence.slice(start, at)) ? `${sentence.slice(0, start)}计划${sentence.slice(start)}` : `${sentence.slice(0, at)}计划${sentence.slice(at)}`;
}
