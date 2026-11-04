import type { FocusSection } from "./focus-session";
import type { WikiClaim } from "./wiki-claims";
import { sourceMessageSignature } from "./source-signature";

export function wikiEditorialSignature(section: FocusSection): string {
  return sourceMessageSignature(JSON.stringify([section.title, section.body, section.evidenceIds, section.claims, section.reviewIssue, section.evidenceReview]));
}

export function wikiDraftKept(section: FocusSection): boolean {
  return section.editorialReview?.signature === wikiEditorialSignature(section);
}

export function keepWikiDraft(section: FocusSection, now = Date.now()): FocusSection {
  return { ...section, editorialReview: { signature: wikiEditorialSignature(section), keptAt: now } };
}

/** Locally anchored extractions remain generated records, never verified facts. */
export function usableWikiClaim(section: FocusSection, claim: WikiClaim): boolean {
  return claim.verification === "supported" || claim.verification === undefined && section.evidenceReview?.mode === "manual" && section.evidenceReview.status === "anchored";
}
