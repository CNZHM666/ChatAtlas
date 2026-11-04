import type { ProjectHistoryEvent } from "./project-state";
import {projectSubjectGroups,projectSubjectKey} from "./project-subjects";

export const historyStateKey = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, "").replace(/[。.!！;；]+$/u, "");
export const productReleaseKey = (version: string) => historyStateKey(version).replace(/^(?:milestone|里程碑)(\d+)$/u, "m$1");

/** A shared quotation is not a shared state identity. Preserve explicit whole-state correspondence. */
export function historyReplacementTargets(later: ProjectHistoryEvent, candidates: ProjectHistoryEvent[]) {
  // A supported relation resolved from originals links stable claim IDs, so a
  // reworded prior state still connects. Literal equality remains for records
  // read before relations existed.
  const linked = new Set((later.relations ?? []).filter(relation => relation.resolution === "supported" && relation.fromClaimId === later.claimId && (relation.kind === "replaces" || relation.kind === "rejects")).flatMap(relation => relation.toClaimId ? [relation.toClaimId] : []));
  const related = linked.size ? candidates.filter(earlier => earlier !== later && earlier.claimId !== undefined && linked.has(earlier.claimId)) : [];
  if (!later.before.trim()) return related;
  const subjects=projectSubjectGroups([...candidates,later]);
  const sameArea = candidates.filter(earlier => earlier.id !== later.id && (!later.area || !earlier.area || projectSubjectKey(later,subjects)===projectSubjectKey(earlier,subjects)));
  const exact = sameArea.filter(earlier => historyStateKey(earlier.after) === historyStateKey(later.before));
  return [...new Set([...exact, ...related])];
}
