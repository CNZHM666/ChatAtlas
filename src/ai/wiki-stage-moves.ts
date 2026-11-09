import type { WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { wikiSaidLater } from "../shared/wiki-sources";

/** Something moved out of one stage into another: "CSV export implementation/fix is moved from Milestone 1 to
 * Milestone 2." What moved, and the stage it left. */
const MOVED_OUT = /^(.+?)\s+(?:is|are|was|were|has been|have been)\s+(?:moved|shifted|deferred|pushed)\s+(?:out\s+)?from\s+(milestone|phase|stage|m)\s*(\d+)\b/iu;
/** A line about one numbered stage, opening with it: "Milestone 1 is complete when …". */
const ABOUT_STAGE = /^(?:(?:the\s+)?(?:revised|updated|new|current|original)\s+)?(milestone|phase|stage|m)\s*(\d+)\b/iu;
/** Words naming the work rather than what it is. */
const GENERIC = new Set(["implementation", "fix", "feature", "features", "support", "work", "functionality", "the", "and", "or", "of", "for", "a", "an"]);
const kindOf = (word: string) => (/^m$/iu.test(word) ? "milestone" : word.toLowerCase());
const stems = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/u).filter(word => word.length >= 3 && !GENERIC.has(word)).map(word => word.slice(0, 6));

/** A stage's earlier line naming what a later move took out of it is replaced by that move: "Milestone 1 is complete
 * when expenses can be added, edited, displayed, and exported …", from the first roadmap, stood beside the revision
 * moving CSV export from Milestone 1 to Milestone 2, and Milestone 1 read as needing the export and excluding it.
 * Lines that themselves say the item is left out ("… excluding CSV export") agree with the move and stay. */
export function stageMoveReplacements(organization: WikiKnowledgeOrganization, units: Map<string, WikiKnowledgeUnit>, report: Record<string, number> = {}): WikiKnowledgeOrganization {
  const all = [...units.values()], added: WikiKnowledgeOrganization["relations"] = [];
  const related = new Set(organization.relations.map(relation => `${relation.older}>${relation.newer}`));
  for (const move of all) {
    const moved = move.statement.match(MOVED_OUT);
    if (!moved) continue;
    const what = stems(moved[1]), kind = kindOf(moved[2]), stage = moved[3];
    if (!what.length) continue;
    for (const unit of all) {
      if (unit === move || unit.evidence.conversationId !== move.evidence.conversationId || !wikiSaidLater(move, unit)) continue;
      const about = unit.statement.match(ABOUT_STAGE);
      if (!about || kindOf(about[1]) !== kind || about[2] !== stage || MOVED_OUT.test(unit.statement)) continue;
      // "without data corruption" is no exclusion; "excluding CSV export" is.
      if (/\b(?:exclud\w*|except|no longer|moved)\b/iu.test(unit.statement)) continue;
      const own = new Set(stems(unit.statement));
      if (!what.some(stem => own.has(stem))) continue;
      if (related.has(`${unit.id}>${move.id}`)) continue;
      related.add(`${unit.id}>${move.id}`);
      added.push({ older: unit.id, newer: move.id, kind: "replaces", status: "resolved", evidence: move.evidence.quote.slice(0, 120) });
    }
  }
  if (!added.length) return organization;
  report.stage_moves_replaced = (report.stage_moves_replaced ?? 0) + added.length;
  return { ...organization, relations: [...organization.relations, ...added] };
}

/** A move the user told among other changes: "Revise the roadmap: move CSV export into milestone 2, and drop the
 * "shared budgets" milestone entirely." */
const MOVE_INTO = /\bmove\s+(?:the\s+)?(.+?)\s+(?:in)?to\s+(?:the\s+)?(milestone|phase|stage|m)\s*(\d+)\b/iu;
const SENTENCE = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
/** A decision of the user's that extraction kept only half of: the message moved CSV export into milestone 2 and
 * dropped shared budgets, and only the drop became a decision; the move was told as the AI's roadmap. Each move the
 * user's decision quotes with no point of that message telling it becomes a decision of its own, in the user's words,
 * under the same subject and the same quote, which says it is the user's choice. Reading only: the stored ledger keeps what extraction gave. */
export function withQuotedMoves(ledger: WikiKnowledgeLedger, report: Record<string, number> = {}): WikiKnowledgeLedger {
  const units = ledger.batches.flatMap(batch => batch.units), added = new Map<string, WikiKnowledgeUnit[]>();
  for (const unit of units) {
    if (unit.evidence.role !== "user" || unit.adoption.status !== "user_decision") continue;
    for (const clause of unit.evidence.quote.split(/[;；\n]|,\s*and\s+|\.\s+/u)) {
      const hit = clause.match(MOVE_INTO);
      if (!hit) continue;
      const what = hit[1].replace(/^["“']|["”']$/gu, "").trim(), kind = kindOf(hit[2]), stage = hit[3], whatStems = stems(what);
      if (!whatStems.length) continue;
      const id = `${unit.id}:move:${whatStems.join("-")}:${stage}`;
      // Told already by a point of the same message, or added from another of its decisions.
      const told = units.some(other => other.evidence.messageId === unit.evidence.messageId && new RegExp(`\\b${kind === "milestone" ? "(?:milestone|m)" : kind}\\s*${stage}\\b`, "iu").test(other.statement) && whatStems.every(stem => stems(other.statement).includes(stem)));
      if (told || units.some(other => other.id === id) || [...added.values()].flat().some(other => other.id === id)) continue;
      const stageName = kind === "milestone" ? "Milestone" : SENTENCE(kind);
      const derived: WikiKnowledgeUnit = { ...unit, id, statement: `${SENTENCE(what)} moves to ${stageName} ${stage}.`, kind: "decision", details: [] };
      added.set(unit.id, [...added.get(unit.id) ?? [], derived]);
    }
  }
  if (!added.size) return ledger;
  report.quoted_moves_added = [...added.values()].flat().length;
  const batches = ledger.batches.map(batch => batch.units.some(unit => added.has(unit.id)) ? { ...batch, units: batch.units.flatMap(unit => [unit, ...added.get(unit.id) ?? []]) } : batch);
  const organization = ledger.organization && { ...ledger.organization, subjects: ledger.organization.subjects.map(subject => subject.unitIds.some(id => added.has(id)) ? { ...subject, unitIds: subject.unitIds.flatMap(id => [id, ...(added.get(id) ?? []).map(unit => unit.id)]) } : subject) };
  return { ...ledger, batches, ...(organization ? { organization } : {}) };
}
