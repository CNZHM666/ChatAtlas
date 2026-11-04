import { statementsConflict, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";

/** A generated replacement edge is a candidate, not proof of an exclusive choice.
 * Style and journey, or a mock and deferred API integration, can hold together. */
export function exclusiveWikiVersions(older: WikiKnowledgeUnit, newer: WikiKnowledgeUnit): boolean {
  if (older.about?.name !== newer.about?.name) return false;
  if (older.facet && newer.facet && older.facet !== newer.facet) return false;
  return statementsConflict(older.statement, newer.statement)
    || /改(?:为|成|放)|换(?:成|为)|取代|替代|而非|不再|\b(?:instead|replace[sd]?|rather than|switch(?:ed)? to)\b/iu.test(newer.statement);
}
