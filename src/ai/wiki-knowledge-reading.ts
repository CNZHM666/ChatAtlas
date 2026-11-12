import { preserveMergedWikiDecisions } from "./wiki-decision-coverage";
import { retitleMisnamedChapters, routeOutOfReferences, routeWikiUnits } from "./wiki-unit-routing";
import { withDiscussedProjects } from "./wiki-knowledge-units";
import { withAnswerScope, withAnsweredOpenPoints, withSettledByAnswer, withAnsweredChoices, withDeclinedProposals, withTurnedDownRestatements, withSetAsideAlternatives, withSetAsideOffers, withSoundAnswers } from "./wiki-question-parse";
import { stageMoveReplacements, withQuotedMoves } from "./wiki-stage-moves";
import { scopedWikiDraft, statementsConflict, withoutOwnProjectAnswers, withUserAnswers, withUserRelations, wikiLedgerUnits, type WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { explicitSwitches, gatherAcrossStages, gatherNamedItems, gatherPositioning, gatherTwins, gatherVersions, placeUnitsByKind } from "./wiki-knowledge-organize";
import { scopedWishes, wikiUnitStatuses } from "./wiki-knowledge-state";
import { laterSettings } from "./wiki-later-settings";
import { chooseGroupHomes } from "./wiki-knowledge-groups";
import { exclusiveWikiVersions } from "./wiki-version-conflict";
import { wikiUserChooses } from "../shared/wiki-user-choice";
import { withUnsaidPlansOut } from "../shared/wiki-unsaid-plan";
import { wikiSaidLater } from "../shared/wiki-sources";
import { answeredTogether, explicitExclusions, withUserQuestionsAsked } from "./wiki-user-questions";

/** One reversible interpretation for writing, reading and export. The source ledger and
 * the user's answers remain untouched; never store these deductions as user verdicts. */
/** Two statements taking opposite sides of one pair (深色 / 浅色, 显示 / 隐藏): one says what the other rules out. */
const OPPOSITES: Array<[string, string]> = [["深色", "浅色"], ["显示", "隐藏"], ["启用", "禁用"], ["本地", "云端"], ["服务端", "客户端"], ["同步", "异步"]];
function opposedSides(first: string, second: string) {
  return OPPOSITES.some(([a, b]) => first.includes(a) && !first.includes(b) && second.includes(b) && !second.includes(a) || first.includes(b) && !first.includes(a) && second.includes(a) && !second.includes(b));
}

export function resolveWikiReading(stored: WikiKnowledgeLedger) {
  // Answers a question should not have offered (the project named as another, a label against its point) are not taken.
  // What a chosen option set aside as still open is settled by it (withSettledByAnswer), and the points elsewhere saying
  // an answered choice is still open are settled with it (withAnsweredOpenPoints).
  // An answer confirming only an account of facts is the user's choice in its own words (withAnsweredChoices).
  // And a move the user's decision quotes, which extraction left out, is a decision of its own (withQuotedMoves).
  const report: Record<string, number> = {};
  const source = withQuotedMoves(withAnsweredOpenPoints(withSettledByAnswer(withSetAsideAlternatives(withSetAsideOffers(withTurnedDownRestatements(withDeclinedProposals(withAnsweredChoices(withAnswerScope(withoutOwnProjectAnswers(withSoundAnswers(withUserQuestionsAsked(withUnsaidPlansOut(stored), report))))))))))), report);
  const answered = withUserAnswers(withUserRelations(withDiscussedProjects(source)));
  const units = wikiLedgerUnits(answered), known = new Map(units.map(unit => [unit.id, unit]));
  const answeredIds = new Set((source.userAnswers ?? []).flatMap(answer => answer.unitIds));
  const checked = answered.organization ? { ...answered.organization, relations: answered.organization.relations.map(relation => {
    const older = known.get(relation.older), newer = known.get(relation.newer);
    // A later point that contradicts an earlier decision (保留深色风格 after 采用浅色风格) still loses to it.
    // Otherwise a point said later in the same conversation is never replaced by an earlier one: "默认仅保存在当前浏览器会话中"
    // (message 50) did not replace "默认仅保存在运行时内存……可选 sessionStorage" (message 53), which says how. It adds to it.
    if (relation.kind === "replaces" && older && newer && !answeredIds.has(older.id) && !answeredIds.has(newer.id) && wikiSaidLater(older, newer) && !statementsConflict(older.statement, newer.statement) && !opposedSides(older.statement, newer.statement)) {
      report.backward_replacements = (report.backward_replacements ?? 0) + 1;
      return { ...relation, kind: "supplements" as const, older: newer.id, newer: older.id, status: "resolved" as const };
    }
    if (!["replaces", "rejects"].includes(relation.kind) || relation.evidence || !older || !newer || exclusiveWikiVersions(older, newer)) return relation;
    const sameFacet = !older.facet || !newer.facet || older.facet === newer.facet;
    if (relation.status === "resolved" && sameFacet && (newer.adoption.status === "user_adopted" || newer.adoption.status === "user_decision" && wikiUserChooses(newer.evidence.quote))) return relation;
    report.compatible_relations = (report.compatible_relations ?? 0) + 1;
    return { ...relation, kind: "coexists" as const, status: "resolved" as const };
  }) } : undefined;
  // A later point ruling out what an earlier one proposed ("……而非青少年") replaces it.
  const excluding = checked ? explicitExclusions(checked, known, report) : undefined;
  let organization = excluding ? explicitSwitches(scopedWishes(gatherPositioning(gatherNamedItems(gatherVersions(gatherTwins(gatherAcrossStages(placeUnitsByKind(excluding, known, report), known, report), known, report), known, report), known, report), known, report), known, report), known, report) : undefined;
  if (organization) {
    // A setting given again later with another value: the earlier value is the earlier version (600～720px → 760~800px).
    // Not one the user answered about or decided.
    organization = laterSettings(organization, known, report, id => answeredIds.has(id) || Boolean(source.decisions?.[id]));
    // What a later move took out of a stage leaves that stage's earlier line naming it (stageMoveReplacements).
    organization = stageMoveReplacements(organization, known, report);
    organization = preserveMergedWikiDecisions(organization, wikiUnitStatuses(units, organization, source.decisions), report);
    // Named for what it holds first, so the plans routed next find the plan chapter.
    // A learning record's 学习路线 chapter is what it is about, not a project's misnamed plan.
    if (source.documentType !== "learning") organization = retitleMisnamedChapters(organization, known, report);
    const unrouted = organization;
    organization = routeWikiUnits(organization, known, report);
    organization = routeOutOfReferences(organization, known, report);
    organization = answeredTogether(unrouted, organization, source.userAnswers, report, source.decisions, known);
  }
  if (organization?.groups?.length) organization = { ...organization, groups: chooseGroupHomes(organization.groups, organization.subjects, units, organization.groups, report) };
  const ledger = { ...answered, ...(organization ? { organization } : {}), ...(source.draft ? { draft: scopedWikiDraft(source) } : {}) };
  const statuses = wikiUnitStatuses(units, organization ?? { relations: [] }, source.decisions);
  return { ledger, organization, units, statuses, report };
}
