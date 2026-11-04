/** Local subtraction pass shared by both knowledge-composition pipelines. */
export const COMPOSITION_BUDGET = {
  conversation: { bridges: 3, freeCards: 2 },
  knowledge: { bridges: 5, freeCards: 3 },
} as const;

export function compositionKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function usefulCompositionText(text: unknown, surrounding: string[], min = 8): text is string {
  if (typeof text !== "string") return false;
  const key = compositionKey(text);
  if (key.length < min || key.length > 180 || /^(相关|有关|值得思考|有联系|继续讨论|其他|待补充)$/u.test(key)) return false;
  return !surrounding.some((item) => {
    const other = compositionKey(item);
    return other.length >= 8 && (key === other || key.includes(other) || other.includes(key));
  });
}

export function selectCompositionCandidates<T>(candidates: T[], limit: number, keyOf: (candidate: T) => string, valid: (candidate: T) => boolean): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const candidate of candidates) {
    const key = compositionKey(keyOf(candidate));
    if (!key || seen.has(key) || !valid(candidate)) continue;
    seen.add(key);
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}
