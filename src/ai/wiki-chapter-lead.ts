import { decidedAgainstDeclined } from "../shared/wiki-differing-plans";
import { knowledgeTerms } from "../shared/knowledge-subject";
import type { WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";
import type { resolveWikiReading } from "./wiki-knowledge-reading";
import { wikiConfirmationScopes } from "./wiki-confirmation-scope";

/** Share of a decision's words the chapter's opening must say for the decision to be what the opening tells. */
const OPENING_TELLS = .5;

export interface WikiChapterLead {
  unit: WikiKnowledgeUnit;
  status: WikiUnitStatus;
  /** A confirmed compound plan includes a detail that still needs checking. */
  disputedDetail?: string;
  /** The user's choice confirming only part of this proposal: the choice leads as decided, the rest stays the AI's
   * proposal. One record's 商业运营 lead read 「免费体验加订阅模式：先免费开放7天…¥19.9…」 as one AI suggestion, while the
   * user had chosen 免费体验+订阅制 and none of the trial, price or plan terms. */
  confirmedChoice?: WikiKnowledgeUnit;
}

/** Pick what to show by chapter membership and unit IDs, never by matching a
 * generated opening's wording. The consumer must still resolve its evidence. */
export function wikiChapterLeads({ ledger: reading, organization, statuses, units }: ReturnType<typeof resolveWikiReading>): Map<string, WikiChapterLead[]> {
  if (!organization || !reading.draft || reading.documentType === "learning") return new Map();
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const included = new Set(organization.subjects.flatMap(subject => subject.unitIds));
  const conflicts = new Map(decidedAgainstDeclined(units.filter(unit => included.has(unit.id)), id => statuses.get(id),
    id => reading.decisions?.[id]?.verdict === "rejected" || byId.get(id)?.adoption.status === "rejected")
    .map(item => [item.decidedId, item.clause]));
  const choices = new Map<string, WikiKnowledgeUnit>();
  for (const scope of wikiConfirmationScopes(reading, byId, statuses)) if (!choices.has(scope.proposal.id)) choices.set(scope.proposal.id, scope.decision);
  return new Map(reading.draft.chapters.map(chapter => {
    const topic = chapter.paragraphs.find(paragraph => paragraph.unitIds.some(id => included.has(id)))?.subtopic;
    const primary = chapter.paragraphs.filter(paragraph => paragraph.subtopic === topic).flatMap(paragraph => paragraph.unitIds);
    const order = [...new Set([...chapter.openingUnitIds ?? [], ...primary])];
    const topicTerms = [...knowledgeTerms(chapter.title)].filter(term => !/^(?:设计|技术|机制|策略|方案|规划|系统|状态|实现|design|technical|system|plan|strategy|status|implementation)$/iu.test(term));
    const candidates = order.flatMap(id => {
      const unit = byId.get(id), status = statuses.get(id);
      if (!unit || !status || !included.has(id) || status === "history" || unit.kind === "question" || unit.kind === "history" || unit.about?.role === "other_project") return [];
      const disputedDetail = conflicts.get(id), confirmedChoice = status === "proposal" ? choices.get(id) : undefined;
      return [{ unit, status, ...(disputedDetail ? { disputedDetail } : {}), ...(confirmedChoice ? { confirmedChoice } : {}) }];
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
    return [chapter.id, candidates.sort((a, b) => leading(a) - leading(b) || (topicAnchored ? Number(topical.has(b.unit.id)) - Number(topical.has(a.unit.id)) : 0) || rank(a) - rank(b))];
  }));
}
