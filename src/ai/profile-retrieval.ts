import type { ConversationSemanticProfile } from "../shared/types";
import { canonicalConceptTitle, conceptKey } from "./concept-canonicalizer";
import { compositionKey } from "./composition-guard";

/** Retrieve a small local context set; no transcript or provider request is needed. */
export function selectHistoricalProfiles(
  selected: ConversationSemanticProfile[],
  cached: ConversationSemanticProfile[],
  linkedConversationIds: Set<string>,
  limit = 32,
): ConversationSemanticProfile[] {
  const selectedIds = new Set(selected.map((profile) => profile.conversationId));
  const concepts = new Set(selected.flatMap((profile) => profile.concepts.map((name) => conceptKey(canonicalConceptTitle(name)))));
  const domains = new Set(selected.flatMap((profile) => profile.domains.map(compositionKey)));
  return cached.filter((profile) => linkedConversationIds.has(profile.conversationId) && !selectedIds.has(profile.conversationId))
    .map((profile) => ({ profile, score: profile.concepts.filter((name) => concepts.has(conceptKey(canonicalConceptTitle(name)))).length * 3 + profile.domains.filter((name) => domains.has(compositionKey(name))).length }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.profile.updatedAt - a.profile.updatedAt || a.profile.conversationId.localeCompare(b.profile.conversationId))
    .slice(0, limit)
    .map((item) => item.profile);
}
