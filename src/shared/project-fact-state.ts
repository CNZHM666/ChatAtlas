import { statementEvidence } from "./statement-evidence";
import type { FocusEvidence, FocusSession } from "./focus-session";
import type { EffectiveEvolution } from "./project-evolution";
import type { WikiClaim } from "./wiki-claims";

export type ProjectFactStatus = "draft" | "confirmed" | "recorded" | "proposal" | "preference" | "uncertain" | "personal" | "reported" | "planned" | "open" | "background";
// Preserve decimal/version separators, operators and conditions. Formatting
// equality must not collapse v1.2 into v12 or 1.5% into 15%.
export const factTextKey = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s*`]/gu, "").replace(/[。！？.!?]+$/u, "");

/** A shared read projection, not a second editable knowledge store. Only explicit
 * reviewed replacements retire a fact; shared topics and newer mentions do not. */
export function projectFactState(session: FocusSession, effective: EffectiveEvolution[] = []) {
  const previous = effective.flatMap(item => item.previous);
  const retiredTexts = new Set(previous.map(event => factTextKey(event.after)));
  const role = (ref: FocusEvidence) => session.sourceRoles?.[ref.conversationId]?.[ref.messageId]
    ?? [...session.projectState?.sources ?? [], ...session.projectEvolutionAnalysis?.sources ?? [], ...session.projectHistoryAnalysis?.sources ?? []]
      .find(source => source.conversationId === ref.conversationId && source.messageId === ref.messageId)?.role;
  return {
    retired(text: string) { return retiredTexts.has(factTextKey(text)); },
    retiredClaim(claim: WikiClaim) {
      return retiredTexts.has(factTextKey(claim.text));
    },
    claimStatus(claim: WikiClaim, sources: FocusEvidence[], roles = sources.map(role)): ProjectFactStatus {
      if (claim.workStatus === "proposed") return "proposal";
      if (claim.workStatus === "planned") return roles.length > 0 && roles.every(role => role === "assistant") ? "proposal" : "planned";
      if (claim.workStatus === "reported" && roles.includes("user")) return !sources.length||sources.some((source,index)=>roles[index]==="user"&&statementEvidence(source.excerpt,claim.quote).report)?"reported":"uncertain";
      return claim.overviewRole === "decision" ? "uncertain" : "recorded";
    },
  };
}
