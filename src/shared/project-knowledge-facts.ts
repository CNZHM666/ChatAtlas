import type { FocusSession } from "./focus-session";
import type { WikiClaim } from "./wiki-claims";
import { wikiSourceReading, wikiClaimPosition } from "./wiki-source-reading";
import { compareHistoryPositions } from "./history-order";
import { projectFactState, factTextKey, type ProjectFactStatus } from "./project-fact-state";
import {knowledgeOverlap,knowledgeScopesAgree} from "./knowledge-subject";

export interface ProjectKnowledgeFact {
  claim: WikiClaim; sectionId: string; status: ProjectFactStatus; historical: boolean;
  adoption: "accepted" | "proposed" | "unknown";
  implementation: "reported" | "planned" | "unknown";
  sourceChanged: boolean; axis?: string; scope: string; contested?: boolean; role?:WikiClaim["overviewRole"]; scopeConflict:boolean;
}
export interface ProjectKnowledgeConflict { axis: string; facts: ProjectKnowledgeFact[] }
export interface ProjectKnowledgeRelation {from:ProjectKnowledgeFact;to:ProjectKnowledgeFact;kind:NonNullable<WikiClaim["relation"]>["kind"]}
const normalized = (value: string) => factTextKey(value).replace(/[：:、，,;；]/gu, "");

/** Grouping hints are bounded by role, literal version and ownership. They are
 * never proof of adoption, or permission to merge distinct technical layers. */
function factAxis(claim: WikiClaim, role: WikiClaim["overviewRole"]): { axis?: string; scope: string; scopeConflict:boolean } {
  const declared = normalized(claim.subject ?? "");
  const globalStage = /^(?:项目阶段|项目整体阶段|项目开发阶段|当前项目阶段|项目当前阶段|当前阶段|开发阶段|整体阶段|整体开发阶段|项目里程碑|project[.-]?stage|overallprojectstage|projectphase|currentphase|overallphase)$/u.test(declared)
    || !declared && role === "stage" && /(?:当前|目前|现在)(?:的)?(?:项目|整体)|\b(?:current project|project is currently)\b/iu.test(claim.quote);
  const subject = globalStage ? "project-stage" : declared;
  const version = claim.scope?.trim() || claim.quote.match(/\bV\d+(?:\.\d+)+(?:[-\w.]*)?/iu)?.[0] || "";
  const quotedVersion=claim.quote.match(/\bV\d+(?:\.\d+)*(?:[-\w.]*)?/iu)?.[0],declaredVersion=claim.scope?.match(/\bV\d+(?:\.\d+)*(?:[-\w.]*)?/iu)?.[0];
  const scopeConflict=Boolean(quotedVersion&&declaredVersion&&normalized(quotedVersion)!==normalized(declaredVersion));
  const ownership = `${claim.subject??""} ${claim.scope??""} ${claim.quote}`;
  const owner = /BYOK|用户.{0,12}(?:密钥|API\s*Key)|user.{0,15}(?:key|credential)/iu.test(ownership) ? "user-key"
    : /平台.{0,12}(?:密钥|API\s*Key)|platform.{0,15}(?:key|credential)/iu.test(ownership) ? "platform-key" : "";
  // Missing version stays unknown except for an explicit overall-project stage.
  const scope = normalized(version) || (globalStage ? "project" : "");
  return { axis: subject ? JSON.stringify([role === "progress" ? "delivery" : role??"knowledge", subject, owner, scope]) : undefined, scope,scopeConflict };
}

/** All consumers read this view. Facts are never copied into a second editable
 * store, and re-import/save timestamps cannot resolve a historical conflict. */
export function projectKnowledgeFacts(session: FocusSession) {
  const state = projectFactState(session), facts: ProjectKnowledgeFact[] = [];
  for (const section of session.sections) {
    if (section.origin || section.userEdited || section.reviewIssue) continue;
    for (const claim of section.claims ?? []) {
      // A claim that only places a holder mark states nothing of its own: no fact, key conclusion or label comes from it.
      if (claim.markOnly || state.retiredClaim(claim) || !claim.evidenceIds.length) continue;
      const reading = wikiSourceReading(session, claim);
      // A literal original report can supply a missing presentation tag. This
      // does not infer a milestone from a roadmap or from a larger number.
      const role=reading?.currentStage?"stage":claim.overviewRole;
      const axis=factAxis(claim,role);
      const sourceChanged = Boolean(claim.sourceReading && !reading);
      const reported = Boolean(reading?.reported || role === "stage" && reading?.currentStage);
      const status: ProjectFactStatus = sourceChanged || axis.scopeConflict || claim.verification === "uncertain" ? "uncertain"
        : reported ? "reported" : reading?.status === "confirmed" ? "confirmed"
        : claim.workStatus === "proposed" ? "proposal" : claim.workStatus === "planned" ? reading?.status === "proposal" ? "proposal" : "planned"
        : reading?.status ?? "draft";
      facts.push({claim, role, sectionId: section.id, status, historical: false, sourceChanged, ...axis,
        adoption: reading?.status === "confirmed" || claim.userDecided ? "accepted" : reading?.status === "proposal" || claim.workStatus === "proposed" ? "proposed" : "unknown",
        implementation: reading?.reported ? "reported" : claim.workStatus === "planned" || reading?.status === "planned" ? "planned" : "unknown"});
    }
  }
  const authoritative = (fact: ProjectKnowledgeFact) => !fact.sourceChanged && fact.status !== "uncertain" &&
    (fact.role === "stage" ? Boolean(wikiSourceReading(session, fact.claim)?.currentStage) : fact.adoption === "accepted" || fact.implementation === "reported");
  const relations:ProjectKnowledgeRelation[]=[];
  for(const fact of facts.filter(authoritative)){
    const link=fact.claim.relation;if(!link||fact.role==="stage")continue;
    const targets=facts.filter(target=>target!==fact&&authoritative(target)&&factTextKey(target.claim.quote)===factTextKey(link.targetQuote));
    if(targets.length!==1)continue;
    const target=targets[0],quote=fact.claim.quote;
    const lane=fact.adoption==="accepted"&&target.adoption==="accepted"||fact.implementation==="reported"&&target.implementation==="reported";
    if(!lane||!fact.scope||fact.scope!==target.scope||!knowledgeScopesAgree(quote,target.claim.quote)||!knowledgeOverlap(quote,target.claim.quote).length||(compareHistoryPositions(wikiClaimPosition(session,fact.claim),wikiClaimPosition(session,target.claim))??0)<=0)continue;
    const cue=link.kind==="replaces"?wikiSourceReading(session,fact.claim)?.replacement
      :link.kind==="narrows"?/收窄|缩小|限定|先只|仅|\b(?:narrow|restrict|only)\b/iu.test(quote)
      :link.kind==="supplements"?/补充|另外|还要|同时|\b(?:also|additional|supplement)\b/iu.test(quote)
      :link.kind==="coexists"?/同时|分别|并存|两者|\b(?:both|alongside|coexist)\b/iu.test(quote)
      :/冲突|不一致|尚未统一|\b(?:conflict|contradict)\b/iu.test(quote);
    if(!cue)continue;
    relations.push({from:fact,to:target,kind:link.kind});
    if(link.kind!=="coexists"&&link.kind!=="conflicts")fact.axis=target.axis;
  }
  for (const fact of facts.filter(authoritative)) {
    if (!fact.axis) continue;
    fact.historical = facts.some(later => later !== fact && later.axis === fact.axis && authoritative(later) &&
      (fact.role === "stage" || fact.adoption === "accepted" && later.adoption === "accepted" || fact.implementation === "reported" && later.implementation === "reported") &&
      (fact.role === "stage" || relations.some(link=>link.from===later&&link.to===fact&&["replaces","narrows"].includes(link.kind)) || fact.scope && wikiSourceReading(session, later.claim)?.replacement&&!relations.some(link=>link.from===later&&link.to===fact&&["supplements","coexists"].includes(link.kind))) &&
      (compareHistoryPositions(wikiClaimPosition(session, later.claim), wikiClaimPosition(session, fact.claim)) ?? 0) > 0);
  }
  const groups = new Map<string, ProjectKnowledgeFact[]>();
  for (const fact of facts.filter(fact => !fact.historical && authoritative(fact))) {
    if (!fact.axis) continue;
    const lane = fact.role === "stage" ? "stage" : fact.adoption === "accepted" ? "adoption" : "delivery";
    const groupKey = JSON.stringify([fact.axis, lane]);
    const group = groups.get(groupKey) ?? [];
    // Different phrasing of the same original quotation is not a disagreement.
    if (!group.some(previous => factTextKey(previous.claim.quote) === factTextKey(fact.claim.quote))) group.push(fact);
    groups.set(groupKey, group);
  }
  const conflicts: ProjectKnowledgeConflict[] = [];
  for (const [axis, group] of groups) if (group.length > 1) {
    const unresolved=group.filter(fact=>group.some(other=>other!==fact&&!relations.some(link=>((link.from===fact&&link.to===other)||(link.from===other&&link.to===fact))&&["supplements","coexists","narrows"].includes(link.kind))));
    if(unresolved.length<2)continue;
    conflicts.push({axis, facts: unresolved});
    for (const fact of unresolved) fact.contested = true;
  }
  const current = facts.filter(fact => !fact.historical && fact.status !== "uncertain");
  const stages = current.filter(fact => fact.role === "stage" && wikiSourceReading(session, fact.claim)?.currentStage);
  return {facts, current, stages, conflicts,relations};
}
