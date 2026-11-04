import { preserveMergedWikiDecisions } from "./wiki-decision-coverage";
import { retitleMisnamedChapters, routeOutOfReferences, routeWikiUnits } from "./wiki-unit-routing";
import { withDiscussedProjects } from "./wiki-knowledge-units";
import { scopedWikiDraft, statementsConflict, withUserAnswers, withUserRelations, wikiLedgerUnits, type WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { explicitSwitches, gatherAcrossStages, gatherNamedItems, gatherPositioning, gatherTwins, gatherVersions, placeUnitsByKind } from "./wiki-knowledge-organize";
import { scopedWishes, wikiUnitStatuses } from "./wiki-knowledge-state";
import { chooseGroupHomes } from "./wiki-knowledge-groups";
import { exclusiveWikiVersions } from "./wiki-version-conflict";
import { wikiUserChooses } from "../shared/wiki-user-choice";

/** One reversible interpretation for writing, reading and export. The source ledger and
 * the user's answers remain untouched; never store these deductions as user verdicts. */
/** Two statements taking opposite sides of one pair (深色 / 浅色, 显示 / 隐藏): one says what the other rules out. */
const OPPOSITES: Array<[string, string]> = [["深色", "浅色"], ["显示", "隐藏"], ["启用", "禁用"], ["本地", "云端"], ["服务端", "客户端"], ["同步", "异步"]];
function opposedSides(first: string, second: string) {
  return OPPOSITES.some(([a, b]) => first.includes(a) && !first.includes(b) && second.includes(b) && !second.includes(a) || first.includes(b) && !first.includes(a) && second.includes(a) && !second.includes(b));
}

export function resolveWikiReading(source: WikiKnowledgeLedger) {
  const answered = withUserAnswers(withUserRelations(withDiscussedProjects(source))), report: Record<string, number> = {};
  const units = wikiLedgerUnits(answered), known = new Map(units.map(unit => [unit.id, unit]));
  const answeredIds = new Set((source.userAnswers ?? []).flatMap(answer => answer.unitIds));
  const checked = answered.organization ? { ...answered.organization, relations: answered.organization.relations.map(relation => {
    const older = known.get(relation.older), newer = known.get(relation.newer);
    // A later point that contradicts an earlier decision (保留深色风格 after 采用浅色风格) still loses to it.
    // Otherwise a point said later in the same conversation is never replaced by an earlier one: "默认仅保存在当前浏览器会话中"
    // (message 50) did not replace "默认仅保存在运行时内存……可选 sessionStorage" (message 53), which says how. It adds to it.
    if (relation.kind === "replaces" && older && newer && !answeredIds.has(older.id) && !answeredIds.has(newer.id) && older.evidence.conversationId === newer.evidence.conversationId && older.evidence.messageIndex > newer.evidence.messageIndex && !statementsConflict(older.statement, newer.statement) && !opposedSides(older.statement, newer.statement)) {
      report.backward_replacements = (report.backward_replacements ?? 0) + 1;
      return { ...relation, kind: "supplements" as const, older: newer.id, newer: older.id, status: "resolved" as const };
    }
    if (!["replaces", "rejects"].includes(relation.kind) || relation.evidence || !older || !newer || exclusiveWikiVersions(older, newer)) return relation;
    const sameFacet = !older.facet || !newer.facet || older.facet === newer.facet;
    if (relation.status === "resolved" && sameFacet && (newer.adoption.status === "user_adopted" || newer.adoption.status === "user_decision" && wikiUserChooses(newer.evidence.quote))) return relation;
    report.compatible_relations = (report.compatible_relations ?? 0) + 1;
    return { ...relation, kind: "coexists" as const, status: "resolved" as const };
  }) } : undefined;
  let organization = checked ? explicitSwitches(scopedWishes(gatherPositioning(gatherNamedItems(gatherVersions(gatherTwins(gatherAcrossStages(placeUnitsByKind(checked, known, report), known, report), known, report), known, report), known, report), known, report), known, report), known, report) : undefined;
  if (organization) {
    organization = preserveMergedWikiDecisions(organization, wikiUnitStatuses(units, organization, source.decisions), report);
    // Named for what it holds first, so the plans routed next find the plan chapter.
    organization = retitleMisnamedChapters(organization, known, report);
    organization = routeWikiUnits(organization, known, report);
    organization = routeOutOfReferences(organization, known, report);
  }
  if (organization?.groups?.length) organization = { ...organization, groups: chooseGroupHomes(organization.groups, organization.subjects, units, organization.groups, report) };
  const ledger = { ...answered, ...(organization ? { organization } : {}), ...(source.draft ? { draft: scopedWikiDraft(source) } : {}) };
  const statuses = wikiUnitStatuses(units, organization ?? { relations: [] }, source.decisions);
  return { ledger, organization, units, statuses, report };
}
