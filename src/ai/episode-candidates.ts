import type { QuestionSnapshot } from "../shared/types";

const dependent = /^(那|那么|这个|这种|它|继续|刚才|上面|第二种|第三种|why\b|and why\b|what about\b|then\b)/iu;
const transition = /^(换个问题|另一个问题|另外|接下来|现在讨论|我们开始|new topic|next topic|moving on)/iu;

export function dependsOnEarlierContext(value: string): boolean { return dependent.test(value.trim()); }

function terms(value: string): Set<string> {
  const words = value.toLocaleLowerCase().match(/[a-z][a-z0-9+#._-]{2,}|[\p{Script=Han}]{2,}/gu) ?? [];
  return new Set(words.flatMap((word) => /^[\p{Script=Han}]+$/u.test(word) ? [...word].slice(0, -1).map((_, index) => word.slice(index, index + 2)) : [word]));
}

export function suggestEpisodeBoundaries(snapshots: QuestionSnapshot[]): Array<{ beforeQuestionId: string; nextQuestionId: string; signals: string[] }> {
  const candidates: Array<{ beforeQuestionId: string; nextQuestionId: string; signals: string[] }> = [];
  for (let index = 1; index < snapshots.length; index++) {
    const before = snapshots[index - 1];
    const current = snapshots[index];
    const signals: string[] = [];
    const title = current.displayTitle || current.summary;
    if (transition.test(title)) signals.push("explicit transition");
    if (dependsOnEarlierContext(title)) signals.push("depends on prior context");
    const previousTerms = terms(`${before.displayTitle} ${before.concepts.join(" ")}`);
    const nextTerms = terms(`${current.displayTitle} ${current.concepts.join(" ")}`);
    const overlap = [...nextTerms].filter((term) => previousTerms.has(term)).length;
    if (!dependsOnEarlierContext(title) && nextTerms.size >= 2 && previousTerms.size >= 2 && overlap === 0) signals.push("low lexical continuity");
    if (signals.length) candidates.push({ beforeQuestionId: before.questionId, nextQuestionId: current.questionId, signals });
  }
  return candidates;
}
