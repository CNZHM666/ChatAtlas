import type { KnowledgeCard } from "../shared/types";

const aliases: Record<string, string> = {
  "极点": "系统极点", "systempoles": "系统极点", "控制系统极点": "系统极点",
  "eigenvalue": "矩阵特征值", "eigenvalues": "矩阵特征值", "特征值": "矩阵特征值",
  "numpyroots": "np.roots", "nproots": "np.roots",
};
export const conceptKey = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export const canonicalConceptTitle = (value: string) => aliases[conceptKey(value)] ?? value.trim();

export function canonicalizeConcepts(cards: KnowledgeCard[], existing: KnowledgeCard[]): { cards: KnowledgeCard[]; idMap: Map<string, string> } {
  const existingByKey = new Map(existing.map((card) => [conceptKey(canonicalConceptTitle(card.title)), card]));
  const chosen = new Map<string, KnowledgeCard>();
  const idMap = new Map<string, string>();
  for (const card of cards) {
    const title = canonicalConceptTitle(card.title);
    const key = conceptKey(title);
    const prior = existingByKey.get(key) ?? chosen.get(key);
    if (prior) {
      idMap.set(card.id, prior.id);
      if (chosen.has(key)) {
        const refs = [...(prior.evidenceRefs ?? []), ...(card.evidenceRefs ?? [])];
        chosen.set(key, { ...prior, evidenceRefs: [...new Map(refs.map((ref) => [`${ref.conversationId}:${ref.questionId ?? ref.messageId ?? ""}`, ref])).values()].slice(0, 8) });
      }
      continue;
    }
    const canonical = { ...card, title };
    chosen.set(key, canonical);
    idMap.set(card.id, canonical.id);
  }
  return { cards: [...chosen.values()], idMap };
}
