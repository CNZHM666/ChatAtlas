import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import { wikiLocalAnswer } from "../ai/wiki-question-parse";
import type { FocusEvidence, FocusSession } from "./focus-session";
import { factTextKey } from "./project-fact-state";
import { projectReviewedClaims } from "./project-continuation";
import { confirmedRoadmaps, confirmedRoadmapText, wikiRoadmapScopes, type WikiConfirmedRoadmap } from "./wiki-confirmed-roadmap";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { availableWikiEvidence, currentWikiEvidence, wikiEvidenceKey } from "./wiki-evidence-link";
import { wikiUnitChapterHomes } from "./wiki-chapter-links";
import { wikiDiscussionOrder } from "./wiki-sources";
import { wikiBlockedUnitIds, wikiStatementWithConditions, type WikiKnowledgeUnit } from "./wiki-knowledge";
import { wikiSections } from "./wiki-navigation";
import type { WikiRoadmapScope } from "./wiki-roadmap-scope";

const ROADMAP = /路线图|版本规划|里程碑计划|版本范围|\b(?:roadmap|release plan|milestone plan)\b/iu;
const RELEASE = /首版|第一版|本版|当前版本|本(?:轮|期|版本)范围|\b(?:MVP|v\d+(?:\.\d+)*|first release|initial release|current release|this release)\b/iu;
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

const REPORTED_DONE = /已(?:经)?(?:完成|实现|发布|上线|部署|通过|修复|加入|接入)|刚(?:刚)?(?:完成|实现|提交|部署)|\b(?:I|we) (?:have |just )?(?:finished|completed|shipped|implemented|deployed|fixed)\b/iu;
const NOT_DONE = /尚未|还没|未完成|待完成|假设|如果|能否|是否|\b(?:not yet|if|would)\b/iu;
const NEXT_STEP = /接下来|下一步|下一阶段|后续|路线图|版本规划|优先(?:推进|实现|开发|验证)|里程碑|\b(?:next (?:step|milestone|phase)|roadmap|follow.up|prioriti[sz]e)\b/iu;
const NOT_NEXT = /^(?:不做|暂无|不支持|禁止)|已(?:被)?(?:放弃|替代|取消)|\b(?:discarded|cancelled|abandoned)\b/iu;

export interface ProjectPlanProposal {
  id: string;
  text: string;
  scope?: string;
  source?: FocusEvidence;
  chapter?: { id: string; heading?: string };
}

function pendingPlan(session: FocusSession, reading: ReturnType<typeof resolveWikiReading>, sourceOf: (unit: WikiKnowledgeUnit) => FocusEvidence | undefined) {
  const blocked = wikiBlockedUnitIds(reading.ledger);
  const recent = reading.units.filter(unit => !blocked.has(unit.id)).sort((a, b) => {
    const dated = a.evidence.discussedAt && b.evidence.discussedAt ? b.evidence.discussedAt - a.evidence.discussedAt : 0;
    return wikiDiscussionOrder(b, a) ?? dated;
  });
  const progress = recent.filter(unit => !unit.about && !unit.evidence.pasted && unit.evidence.role === "user"
    && unit.delivery === "user_reported" && !["history", "open", "contested"].includes(reading.statuses.get(unit.id) ?? "")
    && REPORTED_DONE.test(unit.evidence.quote) && REPORTED_DONE.test(unit.statement)
    && !NOT_DONE.test(unit.statement) && sourceOf(unit));
  const latest = progress[0];
  const reportedProgress = latest ? { date: latest.evidence.discussedAt,
    items: [...new Set(progress.filter(unit => unit.evidence.conversationId === latest.evidence.conversationId
      && unit.evidence.messageId === latest.evidence.messageId).map(unit => unit.statement))].slice(0, 4),
    source: sourceOf(latest),
  } : undefined;
  const baseline = new Set(reading.ledger.draft?.baseline?.filter(item => item.part === "now" && !item.holder).flatMap(item => item.unitIds));
  const homes = wikiUnitChapterHomes(reading.organization), sections = wikiSections(session);
  const reviewed = projectReviewedClaims(session), scopes = wikiRoadmapScopes(reading.ledger);
  const proposals: ProjectPlanProposal[] = [], seen = new Set<string>();
  for (const unit of recent) {
    if (proposals.length >= 3) break;
    const status = reading.statuses.get(unit.id);
    if (unit.about || unit.evidence.pasted || reviewed.shadows(unit.id, unit.statement)
      || (status !== "proposal" && status !== "stated") || (unit.kind !== "plan" && unit.kind !== "decision")
      || NOT_NEXT.test(unit.statement) || !baseline.has(unit.id) && !NEXT_STEP.test(`${unit.subject} ${unit.statement}`)) continue;
    const source = sourceOf(unit), text = wikiStatementWithConditions(unit, session.locale !== "en"), key = factTextKey(text);
    if (!source || !key || seen.has(key)) continue;
    seen.add(key);
    const home = homes.get(unit.id);
    const chapter = home && sections.find(section => section.wikiOwnerId === home || section.id === (session.wikiSectionAliases?.[home] ?? home));
    const scope = scopes.get(unit.id)?.rawLabels;
    proposals.push({ id: unit.id, text, source, scope: scope?.length === 1 ? scope[0] : undefined,
      chapter: chapter ? { id: chapter.id, heading: chapter.title } : undefined });
  }
  return { reportedProgress, proposals: proposals.length ? proposals : undefined };
}

/** Reports and proposals remain separate from commitments the user confirmed. */
export function projectCurrentPlan(session: FocusSession, reading?: ReturnType<typeof resolveWikiReading>) {
  if (session.mode !== "work" || session.wikiKnowledge?.documentType === "learning") return;
  const discussion = discussionRoadmap(session), personal = session.projectMaintenance?.currentPlan?.trim();
  const items: Array<{text:string; source:FocusEvidence; unit:WikiKnowledgeUnit; roadmap?:WikiConfirmedRoadmap; scope?:string; stage?:WikiRoadmapScope; replacementPending?:boolean}> = [];
  const plan = { personal, discussion, items, reportedProgress: undefined as ReturnType<typeof pendingPlan>["reportedProgress"],
    proposals: undefined as ProjectPlanProposal[] | undefined };
  if (personal) return plan;
  if (session.wikiKnowledge) {
    const resolved = reading ?? resolveWikiReading(session.wikiKnowledge);
    const reviewed = projectReviewedClaims(session);
    const sources = new Map(currentWikiEvidence(session).map(ref => [wikiEvidenceKey(ref), ref]));
    const sourceOf = (unit: WikiKnowledgeUnit) => sources.get(wikiEvidenceKey({ ...unit.evidence, excerpt: unit.evidence.quote }));
    const chosen = confirmedRoadmaps(resolved.ledger);
    const scopes = wikiRoadmapScopes(resolved.ledger, chosen.map(({ plan }) => plan));
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
      if (!unit || reviewed.shadows(unit.id, unit.statement)) continue;
      const source = sources.get(wikiEvidenceKey({ ...unit.evidence, excerpt: unit.evidence.quote }));
      if (source) items.push({ text: confirmedRoadmapText(plan, session.locale !== "en"), source, unit, roadmap: plan,
        stage: scopes.get(unit.id),
        replacementPending:replacementPending.has(unit.id) });
    }
    const priority = resolved.units.flatMap(unit => {
      if (unit.about || unit.evidence.pasted || reviewed.shadows(unit.id, unit.statement)
        || resolved.statuses.get(unit.id) !== "confirmed" || conflicts.has(unit.id)) return [];
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
      if (pinned.has(unit.id) || reviewed.shadows(unit.id, unit.statement)) continue;
      if (unit.about || unit.evidence.pasted || !["plan","decision","constraint"].includes(unit.kind)
        || resolved.statuses.get(unit.id) !== "confirmed" || conflicts.has(unit.id)
        || !RELEASE.test(unit.statement) && (unit.kind !== "plan" && unit.kind !== "decision" || !NEXT_STEP.test(unit.statement))) continue;
      const source = sources.get(wikiEvidenceKey({...unit.evidence, excerpt:unit.evidence.quote}));
      const text = wikiStatementWithConditions(unit, session.locale !== "en");
      const key = factTextKey(text);
      if (!source || !key || seen.has(key)) continue;
      seen.add(key);
      const stage = scopes.get(unit.id);
      items.push({text, source, unit, scope:stage?.rawLabels.length===1?stage.rawLabels[0]:undefined, stage, replacementPending:replacementPending.has(unit.id)});
    }
    if (!items.length) Object.assign(plan, pendingPlan(session, resolved, unit => {
      const existing = sourceOf(unit);
      if (existing) return existing;
      const { conversationId, messageId, evidenceId, quote } = unit.evidence;
      if (!quote.trim() || session.evidence.some(ref => ref.conversationId === conversationId && ref.messageId === messageId)
        && ![...sources.values()].some(ref => ref.conversationId === conversationId && ref.messageId === messageId)) return;
      const version = session.sourceVersionIds?.[conversationId], signature = session.sourceSignatures?.[conversationId]?.[messageId];
      if (!version || !signature) return;
      const ref = { id: evidenceId, conversationId, messageId, title: unit.subject, excerpt: quote, sourceVersionId: version, sourceSignature: signature };
      if (availableWikiEvidence(session, ref)) return ref;
    }));
  }
  if (discussion || items.length || plan.reportedProgress || plan.proposals) return plan;
}
