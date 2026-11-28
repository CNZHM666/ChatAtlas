import { sourceMessageSignature } from "../shared/source-signature";
import { wikiSourceTableRole } from "../shared/wiki-source-code";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { claimSupported } from "./wiki-claim-support";
import {
  aboutNameKey, droppedWikiConditions, statesCore, statementsConflict, wikiExploratoryIntent, wikiLedgerUnits, wikiResearchSelection, wikiResearchUse, wikiUnitConditions,
  type WikiChapterPlan, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiKnowledgeOrganization, type WikiKnowledgeUnit,
  type WikiResearchUse, type WikiSubject,
} from "../shared/wiki-knowledge";

export function wikiResearchTopicTitle(title: string, members: readonly WikiKnowledgeUnit[], zh: boolean) {
  if (members.filter(unit => wikiResearchUse(unit) === "conclusion").length >= 3
    && members.every(unit => wikiResearchUse(unit) === "conclusion")
    && !/原则|启示|建议|principles|takeaways|recommendations/iu.test(title)) {
    return zh ? "核心设计原则" : "Core design principles";
  }
  const nameKey = (text: string) => aboutNameKey(text.replace(/\band\b/giu, "").replace(/[/&与和、]/gu, ""));
  const aliases = title.trim().split(/\s+/u);
  for (let at = 1; at < aliases.length; at++) {
    const left = aliases.slice(0, at).join(" "), right = aliases.slice(at).join(" ").replace(/\s*(?:对比|比较|分析|\bcomparison)$/iu, "");
    if (/[&/与和]|\band\b/iu.test(left + right) && nameKey(left) === nameKey(right)
      && members.some(unit => unit.about?.role === "reference" && nameKey(unit.about.name) === nameKey(left))) return right;
  }
  return title;
}

export function refineWikiResearchChapters(chapters: WikiDraftChapter[], ledger: WikiKnowledgeLedger, units: Map<string, WikiKnowledgeUnit>, zh: boolean) {
  if (!wikiResearchSelection(ledger, [...units.values()])) return;
  const isIntent = (id: string) => {
    const unit = units.get(id);
    return unit && ledger.decisions?.[id]?.verdict !== "confirmed" && wikiExploratoryIntent(unit);
  };
  const qualify = (text: string) => zh
    ? text.replace(/(^|[。！？]\s*)((?:(?:截至)?(?:目前|当前|现阶段)[，,]?\s*)?(?:(?:项目)?发起人|用户|你)?(?:只|仅)?(?:已经|已)?(?:确认|确定|敲定)(?:了)?(?:该|这一|此|上述)?(?:核心)?(?:愿景|方向|目标|定位))(?=[。！？、，,；;\s]|$)/gu,
      "$1发起人提出了这一方向")
    : text.replace(/(^|[.!?]\s+)(?:(?:so far|currently)[, ]+)?(?:the (?:initiator|user|project founder) )?(?:has )?(?:only )?confirmed (?:the|this) (?:core )?(?:vision|direction|goal|positioning)\b/giu,
      "$1The project initiator proposed this direction");
  for (const chapter of chapters) {
    const names = new Map<string, string>();
    if (!ledger.organization?.layoutContext) {
      const topics = new Map<string, Set<string>>();
      for (const paragraph of chapter.paragraphs) {
        const ids = topics.get(paragraph.subtopic) ?? new Set<string>();
        for (const id of paragraph.unitIds) ids.add(id);
        topics.set(paragraph.subtopic, ids);
      }
      for (const [topic, ids] of topics) {
        if (!topic) continue;
        const members = [...ids].flatMap(id => units.get(id) ?? []);
        const name = wikiResearchTopicTitle(topic, members, zh);
        if (name !== topic && !topics.has(name) && ![...names.values()].includes(name)) names.set(topic, name);
      }
    }
    chapter.paragraphs = chapter.paragraphs.map(original => {
      let paragraph = original;
      const members = paragraph.unitIds.flatMap(id => units.get(id) ?? []);
      if (!chapter.body.includes(paragraph.text) || wikiDocumentBlocks(paragraph.text).some(block => block.kind !== "paragraph")) return paragraph;
      const polish = (text: string, sources: WikiKnowledgeUnit[]) => {
        if (sources.length && sources.every(unit => isIntent(unit.id))) return qualify(text);
        if (!zh) return text;
        let cleaned = text.replace(/(^|[。！？]\s*)(?:助手|AI)\s*建议\s*(?=AI\s*[\p{L}])/gu, "$1建议");
        if (sources.length && sources.every(unit => unit.about?.role === "reference"
          && !/计划实现|尚未实现|未来将/u.test(unit.evidence.quote))) {
          const neutral = cleaned.replace(/计划实现(?=[^。；]{0,40}(?:可编辑|可验证|版本化|程序化验证))/gu, "便于实现");
          if (neutral !== cleaned && claimSupported(neutral, sources)) cleaned = neutral;
        }
        return cleaned;
      };
      const text = polish(paragraph.text, members);
      if (text !== paragraph.text) {
        chapter.body = chapter.body.replace(paragraph.text, () => text);
        paragraph = { ...paragraph, text, claims: paragraph.claims?.map(claim => ({
          ...claim, text: polish(claim.text, claim.unitIds.flatMap(id => units.get(id) ?? [])),
        })) };
      }
      const references = members.filter(unit => unit.about?.role === "reference");
      if (references.length < 2) return paragraph;
      const sentences = paragraph.text.split(/(?<=[。！？!?])|(?<=\.)\s+/u).map(text => text.trim()).filter(Boolean);
      let claims = paragraph.claims ?? [];
      for (const unit of references) {
        const name = unit.about!.name.toLowerCase(), terms = knowledgeTerms(unit.statement);
        const hits = (text: string) => [...knowledgeTerms(text)].filter(term => terms.has(term)).length;
        const linked = claims.filter(claim => claim.unitIds.includes(unit.id));
        const score = Math.max(0, ...linked.map(claim => hits(claim.text)));
        const matches = sentences.filter(text => text.toLowerCase().includes(name) && statesCore(unit.statement, text)
          && hits(text) > score && !droppedWikiConditions(unit, text).length
          && !statementsConflict(unit.statement, text) && claimSupported(text, [unit]));
        if (matches.length !== 1) continue;
        const sentence = matches[0];
        const next = claims.flatMap(claim => {
          if (claim.text === sentence) return [{ ...claim, unitIds: [...new Set([...claim.unitIds, unit.id])] }];
          if (!claim.unitIds.includes(unit.id) || !claims.some(other => other !== claim && other.text === claim.text)) return [claim];
          const unitIds = claim.unitIds.filter(id => id !== unit.id);
          return unitIds.length ? [{ ...claim, unitIds }] : [];
        });
        if (!next.some(claim => claim.text === sentence)) next.push({ text: sentence, unitIds: [unit.id] });
        claims = next;
      }
      if (!claims.length || claims === paragraph.claims) return paragraph;
      return { ...paragraph, claims: [...claims].sort((left, right) =>
        paragraph.text.indexOf(left.text) - paragraph.text.indexOf(right.text)) };
    });
    if (chapter.openingUnitIds?.length && chapter.openingUnitIds.every(isIntent)) {
      const opening = wikiDocumentBlocks(chapter.body).find(block => block.kind !== "thematicBreak");
      if (opening?.kind === "paragraph" && !chapter.paragraphs.some(paragraph => paragraph.text === opening.text)) {
        chapter.body = chapter.body.slice(0, opening.start) + qualify(opening.text) + chapter.body.slice(opening.end);
      }
    }
    for (const heading of wikiDocumentBlocks(chapter.body).reverse()) {
      const match = heading.kind === "heading" && heading.text.match(/^(#{3,6})\s+(.+)$/u);
      const title = match && names.get(match[2]);
      if (title) chapter.body = chapter.body.slice(0, heading.start) + `${match[1]} ${title}` + chapter.body.slice(heading.end);
    }
    if (names.size) chapter.paragraphs = chapter.paragraphs.map(paragraph => names.has(paragraph.subtopic)
      ? { ...paragraph, subtopic: names.get(paragraph.subtopic)! } : paragraph);
  }
}

/** A structured research answer already gives a directory and source ownership.
 * Keep that layout when one answer can account for the entire short study. */
export function organizeStructuredResearch(ledger: WikiKnowledgeLedger, locale: string, conversations: number, report?: Record<string, number>): WikiKnowledgeOrganization | undefined {
  const units = wikiLedgerUnits(ledger);
  if (!units.length || !wikiResearchSelection(ledger, units)) return;
  const fallback = (reason: string) => {
    if (report) report[`source_structure_fallback_${reason}`] = 1;
    return undefined;
  };
  if (conversations !== 1 || ledger.status !== "complete" || ledger.materials > 12 || units.length > 40) return fallback("scope");
  if (ledger.writingMode === "audit" || ledger.userAnswers?.length || Object.keys(ledger.decisions ?? {}).length || Object.keys(ledger.userOwners ?? {}).length
    || ledger.sameGroups?.length || ledger.separateGroups?.length || ledger.coexisting?.length) return fallback("review");
  const classified = units.map(unit => ({ unit, use: wikiResearchUse(unit) }));
  const has = (use: WikiResearchUse) => classified.some(item => item.use === use);
  const tables = new Set(units.flatMap(unit => unit.evidence.code && wikiSourceTableRole(unit.evidence.code) === "comparison" ? [unit.evidence.code.text] : []));
  if (tables.size !== 1 || !has("conclusion") || !has("comparison") || !has("landscape") && !has("reference")) return fallback("structure");
  const primary = new Set(classified.filter(({ use }) => use && use !== "comparison")
    .map(({ unit }) => unit.evidence.messageId));
  if (primary.size !== 1) return fallback("scope");
  if (units.some(unit => unit.relation || unit.kind === "history" || unit.kind === "question"
    || unit.about?.role === "other_project" || ["user_adopted", "user_decision", "rejected"].includes(unit.adoption.status))) return fallback("review");
  const preface = classified.filter(({ unit, use }) => unit.evidence.role === "assistant" && !use);
  if (preface.some(({ unit }) => unit.evidence.section || unit.evidence.code)
    || classified.some(({ unit, use }) => unit.evidence.role === "assistant"
    && !primary.has(unit.evidence.messageId) && (use !== "comparison" || !tables.has(unit.evidence.code?.text ?? ""))
    || !use && wikiUnitConditions(unit).length)) return fallback("structure");

  const zh = !/^en/iu.test(locale);
  const labels = zh
    ? { purpose: "调研目标", landscape: "赛道格局", comparison: "商业竞品", reference: "开源参考", conclusion: "设计启示" }
    : { purpose: "Research scope", landscape: "Landscape", comparison: "Competitor comparison", reference: "Open-source and technical references", conclusion: "Design takeaways" };
  const subjects: WikiSubject[] = [], chapters: WikiChapterPlan[] = [];
  const buckets = new Map<keyof typeof labels, typeof units>();
  for (const { unit, use } of classified) {
    const lane = use ?? "purpose";
    const list = buckets.get(lane) ?? [];
    list.push(unit);
    buckets.set(lane, list);
  }
  for (const lane of Object.keys(labels) as Array<keyof typeof labels>) {
    const members = buckets.get(lane);
    if (!members?.length) continue;
    const id = `research:${lane}`, title = labels[lane];
    const topics = new Map<string, WikiSubject>();
    for (const unit of members) {
      const name = unit.about?.name ?? (lane === "landscape" ? unit.subject : title);
      const key = aboutNameKey(name);
      let subject = topics.get(key);
      if (!subject) {
        subject = { id: `${id}:${sourceMessageSignature(key)}`, name, aliases: [], unitIds: [] };
        topics.set(key, subject);
        subjects.push(subject);
      }
      subject.unitIds.push(unit.id);
    }
    const subtopics = lane === "comparison"
      ? [{ title: zh ? "竞品对照" : "Comparison table", subjectIds: [...topics.values()].map(subject => subject.id) }]
      : [...topics.values()].map(subject => ({ title: subject.name, subjectIds: [subject.id] }));
    chapters.push({ id, title, question: "", group: "", subtopics });
  }
  return { version: 1, generatedAt: Date.now(), status: "complete", subjects, merged: [], relations: [], chapters, topics: [],
    report: { source_structure_used: 1, source_structure_units: units.length, units: units.length, subjects: subjects.length, chapters: chapters.length } };
}
