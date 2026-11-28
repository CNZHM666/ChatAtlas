import { knowledgeOwner, knowledgeScopesAgree, knowledgeTerms } from "../shared/knowledge-subject";
import { aboutNameKey, modalityConflict, statementsConflict, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { distinctWikiStageScopes } from "../shared/wiki-roadmap-scope";
import { vectorSimilarity, type UnitVectors } from "./wiki-semantic-merge";

const MAX_SHARED_SCORES = 40_000;

/** One organizing run shares the expensive candidate features. Each consumer
 * still decides which pairs qualify for its own kind of comparison. */
export function wikiCandidateIndex() {
  const byText = new Map<string, Set<string>>();
  const vectorScores = new WeakMap<UnitVectors, (a: string, b: string) => number>();
  const pairs = new Map<string, "separate" | "conflict" | "compatible">();
  const scope = new WeakMap<WikiKnowledgeUnit, { entity: string; owner: string | undefined }>();
  const ownership = (unit: WikiKnowledgeUnit) => {
    const prior = scope.get(unit);
    if (prior) return prior;
    const own = { entity: unit.about ? aboutNameKey(unit.about.name) + ":" + unit.about.role : "", owner: knowledgeOwner(unit.statement) };
    scope.set(unit, own);
    return own;
  };
  return {
    compare(a: WikiKnowledgeUnit, b: WikiKnowledgeUnit) {
      const key = a.id < b.id ? JSON.stringify([a.id, b.id]) : JSON.stringify([b.id, a.id]);
      const prior = pairs.get(key);
      if (prior) return prior;
      const x = ownership(a), y = ownership(b);
      const result = x.entity !== y.entity || Boolean(x.owner && y.owner && x.owner !== y.owner)
        || !knowledgeScopesAgree(a.statement, b.statement) || distinctWikiStageScopes(a.statement, b.statement) ? "separate"
        : modalityConflict(a.statement, b.statement) || statementsConflict(a.statement, b.statement) ? "conflict" : "compatible";
      if (pairs.size < MAX_SHARED_SCORES) pairs.set(key, result);
      return result;
    },
    terms(text: string): Set<string> {
      const existing = byText.get(text);
      if (existing) return existing;
      const terms = knowledgeTerms(text);
      byText.set(text, terms);
      return terms;
    },
    similarity(vectors: UnitVectors) {
      const existing = vectorScores.get(vectors);
      if (existing) return existing;
      const score = vectorSimilarity(vectors);
      const ids = new Map([...vectors.keys()].map((id, index) => [id, index]));
      const cached = new Map<number, number>();
      const similar = (a: string, b: string) => {
        const x = ids.get(a), y = ids.get(b);
        if (x === undefined || y === undefined) return 0;
        const key = Math.min(x, y) * ids.size + Math.max(x, y);
        const prior = cached.get(key);
        if (prior !== undefined) return prior;
        const value = score(a, b);
        if (cached.size < MAX_SHARED_SCORES) cached.set(key, value);
        return value;
      };
      vectorScores.set(vectors, similar);
      return similar;
    },
  };
}

export type WikiCandidateIndex = ReturnType<typeof wikiCandidateIndex>;
