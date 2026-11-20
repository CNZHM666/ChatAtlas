import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import { wikiLocalAnswer } from "../ai/wiki-question-parse";
import type { FocusEvidence, FocusSession } from "./focus-session";
import { factTextKey } from "./project-fact-state";
import { confirmedRoadmaps, confirmedRoadmapText, type WikiConfirmedRoadmap } from "./wiki-confirmed-roadmap";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { currentWikiEvidence, wikiEvidenceKey } from "./wiki-evidence-link";
import { wikiStatementWithConditions, type WikiKnowledgeUnit } from "./wiki-knowledge";
import { wikiSections } from "./wiki-navigation";

const ROADMAP = /路线图|版本规划|里程碑计划|版本范围|\b(?:roadmap|release plan|milestone plan)\b/iu;
const RELEASE = /首版|第一版|本版|当前版本|本(?:轮|期|版本)范围|\b(?:MVP|v\d+(?:\.\d+)*|first release|initial release|current release|this release)\b/iu;
const NAMED_RELEASE = /\bv\d+(?:\.\d+)*(?:-[\w-]+)?\b|(?:首版|第[一二三四五六七八九十\d]+\s*(?:版|阶段))|\b(?:MVP|first release|initial release)\b/giu;
const NEXT_PRIORITY = /^(?:是否|要不要)?\s*将\s*(.+?)\s*作为\s*下一阶段(?:的)?\s*(?:最高|首要)优先(?:级)?(?:实施|事项)?[？?]?$/u;
const NEXT_PRIORITY_EN = /^(?:should we|do we)\s+(?:make|treat)\s+(.+?)\s+(?:as\s+)?(?:the\s+)?(?:highest|top) priority (?:in|for) the next (?:stage|phase)\?$/iu;
const PRIORITIZE = /^(?:确认优先(?:实施|推进)?|确认|是|同意|yes|confirm(?: priority)?|prioritize)[。.!]?$/iu;

function discussionRoadmap(session: FocusSession) {
  for (const section of wikiSections(session)) {
    const heading = wikiDocumentBlocks(section.body).find(block => block.kind === "heading"
      && ROADMAP.test(block.text) && !/早先|早期|此前|历史|\b(?:early|earlier|historic)\b/iu.test(block.text));
    if (heading) return {sectionId: section.id, heading: heading.text.replace(/^#+\s+|\n[=-]+$/gu,"").replace(/\*\*|__/gu,"").trim()};
    if (ROADMAP.test(section.title) || /规划与安全合规|Planning and compliance/iu.test(section.title)) return {sectionId: section.id};
  }
}

/** A plan belongs to the user. Until they set one, show only the specific
 * release commitments that can independently be traced to a confirmation. */
export function projectCurrentPlan(session: FocusSession, reading?: ReturnType<typeof resolveWikiReading>) {
  if (session.mode !== "work" || session.wikiKnowledge?.documentType === "learning") return;
  const discussion = discussionRoadmap(session), personal = session.projectMaintenance?.currentPlan?.trim();
  const items: Array<{text:string; source:FocusEvidence; unit:WikiKnowledgeUnit; roadmap?:WikiConfirmedRoadmap; scope?:string; replacementPending?:boolean}> = [];
  if (personal) return {personal, discussion, items};
  if (session.wikiKnowledge) {
    const resolved = reading ?? resolveWikiReading(session.wikiKnowledge);
    const sources = new Map(currentWikiEvidence(session).map(ref => [wikiEvidenceKey(ref), ref]));
    const chosen = confirmedRoadmaps(resolved.ledger);
    const unresolved = resolved.organization?.relations.filter(link => link.status === "unresolved" && ["replaces", "rejects"].includes(link.kind)
      && !chosen.some(({plan, answer}) => [link.older, link.newer].includes(plan.unitId)
        && [link.older, link.newer].some(id => id !== plan.unitId && answer.unitIds.includes(id)
          && session.wikiKnowledge?.decisions?.[id]?.verdict === "rejected" && session.wikiKnowledge.decisions[id].at === answer.at))) ?? [];
    const conflicts = new Set(unresolved.filter(link => resolved.statuses.get(link.older) === "confirmed" && resolved.statuses.get(link.newer) === "confirmed")
      .flatMap(link => [link.older, link.newer]));
    const replacementPending = new Set(unresolved.flatMap(link => [link.older, link.newer]));
    const seen = new Set<string>();
    const pinned = new Set(chosen.map(({ plan }) => plan.unitId));
    for (const { plan } of chosen) {
      const unit = resolved.units.find(item => item.id === plan.unitId);
      if (!unit) continue;
      const source = sources.get(wikiEvidenceKey({ ...unit.evidence, excerpt: unit.evidence.quote }));
      if (source) items.push({ text: confirmedRoadmapText(plan, session.locale !== "en"), source, unit, roadmap: plan, replacementPending:replacementPending.has(unit.id) });
    }
    const priority = resolved.units.flatMap(unit => {
      if (unit.about || unit.evidence.pasted || resolved.statuses.get(unit.id) !== "confirmed" || conflicts.has(unit.id)) return [];
      const answer = wikiLocalAnswer(resolved.ledger, unit.id);
      const target = answer?.question.match(NEXT_PRIORITY)?.[1] ?? answer?.question.match(NEXT_PRIORITY_EN)?.[1];
      const source = target && sources.get(wikiEvidenceKey({ ...unit.evidence, excerpt: unit.evidence.quote }));
      if (!answer || !target || !source || !PRIORITIZE.test(answer.answer.trim())) return [];
      return [{unit, source, target: target.trim(), at: answer.at}];
    }).sort((a, b) => b.at - a.at)[0];
    if (priority) {
      const zh = session.locale !== "en";
      const gap = /^[\w]/u.test(priority.target) ? " " : "";
      items.push({text: zh ? `下一阶段优先推进${gap}${priority.target}。` : `Prioritize ${priority.target} in the next phase.`,
        source: priority.source, unit: priority.unit, scope: zh ? "下一阶段" : "Next phase", replacementPending: replacementPending.has(priority.unit.id)});
      pinned.add(priority.unit.id);
    }
    for (const unit of resolved.units) {
      if (items.length >= 5) break;
      if (pinned.has(unit.id)) continue;
      if (unit.about || unit.evidence.pasted || !["plan","decision","constraint"].includes(unit.kind)
        || resolved.statuses.get(unit.id) !== "confirmed" || conflicts.has(unit.id) || !RELEASE.test(unit.statement)) continue;
      const source = sources.get(wikiEvidenceKey({...unit.evidence, excerpt:unit.evidence.quote}));
      const text = wikiStatementWithConditions(unit, session.locale !== "en");
      const key = factTextKey(text);
      if (!source || !key || seen.has(key)) continue;
      seen.add(key);
      const releases=[...new Set(text.match(NAMED_RELEASE)?.map(value=>value.toLowerCase())??[])];
      items.push({text, source, unit, scope:releases.length===1?releases[0]:undefined, replacementPending:replacementPending.has(unit.id)});
    }
  }
  if (discussion || items.length) return {personal, discussion, items};
}
