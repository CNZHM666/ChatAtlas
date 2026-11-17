import type { FocusSection, FocusSession } from "./focus-session";
import { literalNegationCorrection } from "./claim-meaning";
import { wikiQuoteRange } from "./wiki-claims";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { evidenceSnapshotKey } from "./evidence-identity";

/** Restore unambiguous literal negation in generated prose using its retained original. */
export function restoreWikiSourceNegation(section: FocusSection, session: FocusSession): FocusSection {
  if (section.origin || section.userEdited || !section.claims?.length) return section;
  const claims = section.claims;
  const candidates = claims.flatMap(claim => {
    if (claim.checked || claim.userDecided || claim.markOnly || claim.sourceReading?.status === "confirmed") return [];
    const replacement = literalNegationCorrection(claim.text, claim.quote);
    return replacement && !claims.some(other => other !== claim && other.text === claim.text) ? [{ claim, replacement }] : [];
  });
  if (!candidates.length) return section;
  const blocks = wikiDocumentBlocks(section.body).filter(block => block.kind === "paragraph" || block.kind === "list");
  const byEvidence = new Map(session.evidence.map(ref => [ref.id, ref]));
  const repairs = new Map(candidates.flatMap(({ claim, replacement }) => {
    const at = section.body.indexOf(claim.text);
    if (at < 0 || at !== section.body.lastIndexOf(claim.text) || !blocks.some(block => block.text.includes(claim.text))) return [];
    const originals = claim.evidenceIds.flatMap(id => byEvidence.get(id) ?? []);
    if (!originals.length || originals.length !== claim.evidenceIds.length || originals.some(ref => {
      const live = session.sourceSignatures?.[ref.conversationId]?.[ref.messageId];
      const version = session.sourceVersionIds?.[ref.conversationId];
      return !wikiQuoteRange(ref.excerpt, claim.quote)
        || Boolean(live && ref.sourceSignature && live !== ref.sourceSignature)
        || Boolean(version && ref.sourceVersionId && version !== ref.sourceVersionId)
        || ref.messageId !== originals[0].messageId || evidenceSnapshotKey(session, ref) !== evidenceSnapshotKey(session, originals[0]);
    })) return [];
    return [[claim, replacement] as const];
  }));
  if (!repairs.size) return section;
  let body = section.body;
  for (const [claim, replacement] of repairs) body = body.replace(claim.text, () => replacement);
  return { ...section, body, claims: section.claims.map(claim => repairs.has(claim) ? { ...claim, text: repairs.get(claim)!, formulations: undefined } : claim) };
}
