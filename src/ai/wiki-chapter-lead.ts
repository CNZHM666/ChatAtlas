import { decidedAgainstDeclined } from "../shared/wiki-differing-plans";
import { knowledgeTerms } from "../shared/knowledge-subject";
import type { WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";
import type { resolveWikiReading } from "./wiki-knowledge-reading";
import { wikiConfirmationScopes } from "./wiki-confirmation-scope";
import { currentBaseline, wikiStageTransition } from "./wiki-knowledge-state";
import { wikiSaidLater } from "../shared/wiki-sources";
import { wikiUnitChapterHomes } from "../shared/wiki-chapter-links";

/** Share of a decision's words the chapter's opening must say for the decision to be what the opening tells. */
const OPENING_TELLS = .5;
const ROADMAP_CHAPTER = /开发|实施|迭代|路线图|里程碑|\b(?:roadmap|milestones?|implementation plan|development plan)\b/iu;
const MULTI_STAGE = /(?:\bM\d+|\bMilestone\s*\d+|\bPhase\s*[A-Z0-9]+|第[一二三四五六七八九十\d]+(?:阶段|版))/giu;
export const wikiMultiStageRoadmap = (text: string) => new Set(text.match(MULTI_STAGE)?.map(stage => stage.toLowerCase().replace(/\s+/gu, ""))).size > 1;

export interface WikiChapterLead {
  unit: WikiKnowledgeUnit;
  status: WikiUnitStatus;
  /** A confirmed compound plan includes a detail that still needs checking. */
  disputedDetail?: string;
  /** The user's choice confirming only part of this proposal: the choice leads as decided, the rest stays the AI's
   * proposal. One record's 商业运营 lead read 「免费体验加订阅模式：先免费开放7天…¥19.9…」 as one AI suggestion, while the
   * user had chosen 免费体验+订阅制 and none of the trial, price or plan terms. */
  confirmedChoice?: WikiKnowledgeUnit;
  /** A proposed next step can describe entry into a phase without establishing that entry. */
  nextStep?: true;
}

/** Pick what to show by chapter membership and unit IDs, never by matching a
 * generated opening's wording. The consumer must still resolve its evidence. */
export function wikiChapterLeads({ ledger: reading, organization, statuses, units }: ReturnType<typeof resolveWikiReading>): Map<string, WikiChapterLead[]> {
  if (!organization || !reading.draft || reading.documentType === "learning") return new Map();
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const included = new Set(organization.subjects.flatMap(subject => subject.unitIds));
  const active = units.filter(unit => included.has(unit.id));
  const baseline = currentBaseline(active, statuses, undefined, active.filter(unit => statuses.get(unit.id) === "confirmed"));
  const nextIds = new Set(baseline.filter(item => item.part === "now").flatMap(item => item.unitIds));
  const homes = wikiUnitChapterHomes(organization);
  const conflicts = new Map(decidedAgainstDeclined(units.filter(unit => included.has(unit.id)), id => statuses.get(id),
    id => reading.decisions?.[id]?.verdict === "rejected" || byId.get(id)?.adoption.status === "rejected")
    .map(item => [item.decidedId, item.clause]));
  const choices = new Map<string, WikiKnowledgeUnit>();
  for (const scope of wikiConfirmationScopes(reading, byId, statuses)) if (!choices.has(scope.proposal.id)) choices.set(scope.proposal.id, scope.decision);
  return new Map(reading.draft.chapters.map(chapter => {
    const development = ROADMAP_CHAPTER.test(chapter.title);
    const topic = chapter.paragraphs.find(paragraph => paragraph.unitIds.some(id => included.has(id)))?.subtopic;
    const primary = chapter.paragraphs.filter(paragraph => paragraph.subtopic === topic).flatMap(paragraph => paragraph.unitIds);
    const chapterIds = [...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)];
    const next = development ? [...nextIds].filter(id => chapterIds.includes(id) || homes.get(id) === chapter.id) : [];
    if (development) for (const unit of active) {
      if ((homes.get(unit.id) === chapter.id || chapterIds.includes(unit.id)) && ["plan", "decision"].includes(unit.kind)
        && ["confirmed", "stated", "proposal"].includes(statuses.get(unit.id) ?? "") && wikiStageTransition(unit.statement) && !next.includes(unit.id)) next.push(unit.id);
    }
    const order = [...new Set([...next, ...chapter.openingUnitIds ?? [], ...primary])];
    const topicTerms = [...knowledgeTerms(chapter.title)].filter(term => !/^(?:设计|技术|机制|策略|方案|规划|系统|状态|实现|design|technical|system|plan|strategy|status|implementation)$/iu.test(term));
    const candidates = order.flatMap(id => {
      const unit = byId.get(id), status = statuses.get(id);
      if (!unit || !status || !included.has(id) || status === "history" || unit.kind === "question" || unit.kind === "history" || unit.about?.role === "other_project") return [];
      const disputedDetail = conflicts.get(id), confirmedChoice = status === "proposal" ? choices.get(id) : undefined;
      if (development && status === "proposal" && wikiMultiStageRoadmap(unit.statement)
        && next.some(nextId => wikiSaidLater(byId.get(nextId)!, unit))) return [];
      return [{ unit, status, ...(next.includes(id) ? { nextStep: true as const } : {}), ...(disputedDetail ? { disputedDetail } : {}), ...(confirmedChoice ? { confirmedChoice } : {}) }];
    });
    const rank = ({ status, confirmedChoice }: WikiChapterLead) => status === "confirmed" || confirmedChoice ? 0 : status === "open" || status === "contested" ? 1 : status === "proposal" ? 2 : 3;
    // A peripheral confirmed detail should not lead a chapter when the opening
    // already cites a unit whose subject names the chapter's topic.
    const topical = new Set(candidates.filter(({ unit }) => {
      const terms = knowledgeTerms(`${unit.subject} ${unit.facet ?? ""}`);
      return topicTerms.some(term => terms.has(term));
    }).map(({ unit }) => unit.id));
    const topicAnchored = chapter.openingUnitIds?.some(id => topical.has(id));
    // A decision the opening tells is the chapter's, never peripheral: 「产品定位为“戒色守护Agent”……」 〔AI 建议〕 led 产品定位
    // for its subject's word while the opening told the confirmed 「长期方向扩展为“年轻男性状态恢复/自律成长”」.
    // So is one the opening says in its words without citing it: 「……首屏仅保留问候语、当前连续坚持天数、状态四选一卡片及动态
    // 主按钮。」 told the confirmed 首屏 decision, cited on two proposals.
    const opening = new Set(chapter.openingUnitIds ?? []), openingTerms = knowledgeTerms(chapter.body.startsWith("### ") || !/\n### /u.test(chapter.body) ? "" : chapter.body.split(/\n### /u)[0]);
    const toldByOpening = (unit: WikiKnowledgeUnit) => { const own = [...knowledgeTerms(unit.statement)], shared = own.filter(term => openingTerms.has(term)).length; return shared >= 3 && shared / Math.max(1, own.length) >= OPENING_TELLS; };
    const leading = (lead: WikiChapterLead) => rank(lead) === 0 && (opening.has(lead.unit.id) || topical.has(lead.unit.id) || toldByOpening(lead.unit)) ? 0 : 1;
    const nextRank = (lead: WikiChapterLead) => next.includes(lead.unit.id) ? 0 : 1;
    return [chapter.id, candidates.sort((a, b) => leading(a) - leading(b) || nextRank(a) - nextRank(b)
      || (a.nextStep && b.nextStep ? rank(a) - rank(b) || (wikiSaidLater(a.unit, b.unit) ? -1 : wikiSaidLater(b.unit, a.unit) ? 1 : 0) : 0)
      || (topicAnchored ? Number(topical.has(b.unit.id)) - Number(topical.has(a.unit.id)) : 0) || rank(a) - rank(b))];
  }));
}
