import type { FocusSection, FocusSession } from "./focus-session";
import { sourceMessageSignature } from "./source-signature";

export type StructureSources = Partial<Pick<FocusSession, "sourceVersionIds" | "evidence">>;

/** Only this chapter's evidence participates; unrelated source additions do not invalidate it. */
export function structureSourceSignature(section: FocusSection, session: StructureSources): string {
  return sourceMessageSignature(JSON.stringify([...new Set(section.evidenceIds)].sort().map(id => {
    const ref = session.evidence?.find(item => item.id === id);
    return [id, ref?.conversationId, ref?.messageId, ref?.sourceVersionId ?? session.sourceVersionIds?.[ref?.conversationId ?? ""], ref?.sourceSignature, ref?.excerpt];
  })));
}

/** Supports old body-only and combined signatures without accepting changed prose. */
export function structureIsCurrent(section: FocusSection, session?: StructureSources): boolean {
  if (section.origin || section.userEdited || !section.semanticStructure?.nodes.length) return false;
  const body = sourceMessageSignature(section.body);
  if (section.semanticSourceSignature) return section.semanticBodySignature === body && (!session || section.semanticSourceSignature === structureSourceSignature(section, session));
  if (!section.semanticBodySignature || section.semanticBodySignature === body) return true;
  return Boolean(session?.sourceVersionIds && section.semanticBodySignature === sourceMessageSignature(JSON.stringify([section.body, session.sourceVersionIds, section.evidenceIds])));
}
