import type { FocusEvidence, FocusSection, FocusSession } from "../shared/focus-session";
import { wikiBlocks, type WikiBlockIssue } from "../shared/wiki-explanations";
import { wikiSections } from "../shared/wiki-navigation";
import { wikiEvidencePoints } from "./wiki-evidence";
import { needsConfirmation } from "./workspace-evidence-context";
import { restoreWikiSourceNegation } from "../shared/wiki-source-negation";

const pendingCache=new WeakMap<FocusSection,{evidence:FocusEvidence[];signatures:FocusSession["sourceSignatures"];
  versions:FocusSession["sourceVersionIds"];zh:boolean;points:ReturnType<typeof wikiEvidencePoints>}>();

/** The count and the review queue share this view of the saved claims. */
export function pendingWikiEvidence(section:FocusSection,session:FocusSession,zh:boolean) {
  const cached=pendingCache.get(section);
  if(cached&&cached.evidence===session.evidence&&cached.signatures===session.sourceSignatures&&cached.versions===session.sourceVersionIds&&cached.zh===zh)return cached.points;
  const points=wikiEvidencePoints(restoreWikiSourceNegation(section,session),session.evidence,zh).filter(needsConfirmation);
  pendingCache.set(section,{evidence:session.evidence,signatures:session.sourceSignatures,versions:session.sourceVersionIds,zh,points});
  return points;
}

export function documentEvidenceReview(session: FocusSession, zh: boolean) {
  return wikiSections(session).flatMap(section => {
    const count = pendingWikiEvidence(section,session,zh).length;
    return count ? [{ sectionId: section.id, count }] : [];
  });
}

const LABELS: Record<WikiBlockIssue["code"], [string, string]> = {
  duplicate_explanation: ["和前文讲的是同一件事", "Says again what an earlier paragraph says"],
  duplicate_with_extra: ["和前文重复，只多了一点内容", "Repeats an earlier paragraph with a little more"],
  unsupported_status: ["把没有确认的建议写成了已决定", "Presents an unconfirmed suggestion as decided"],
  unbound_decision: ["写了决定，但没有标出处", "States a decision without a source"],
  retired_as_current: ["把被替换的旧方案写成了现行方案", "Presents a replaced plan as current"],
};
export const issueLabel = (issue: WikiBlockIssue, zh: boolean) => LABELS[issue.code][zh ? 0 : 1];

/** The paragraph text an issue points at, for finding it in the rendered chapter. */
export function issueBlockText(session: FocusSession, issue: WikiBlockIssue): string | undefined {
  const section = session.sections.find(item => item.id === issue.sectionId);
  return section ? wikiBlocks(section).find(block => block.id === issue.blockId)?.text : undefined;
}
