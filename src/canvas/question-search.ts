/** Searching a conversation's questions: every word typed must appear, a question that says it ranks before an answer
 * that only mentions it, and an answer match shows the line it was found in. Substring search over whole answers listed
 * nearly every question for a word like "Git", in reading order, with nothing saying why. */
export interface QuestionText { head: string; body: string }
export interface QuestionMatch { id: string; inQuestion: boolean; snippet?: string }

const fold = (text: string) => text.toLocaleLowerCase().normalize("NFKC");
/** The words of a query: spaces split them; one word of Chinese stays whole. */
export function questionSearchTerms(query: string): string[] {
  return [...new Set(fold(query).split(/\s+/u).filter(Boolean))];
}
/** Whether every word appears in a text. */
export const matchesTerms = (text: string, terms: readonly string[]) => { const folded = fold(text); return terms.every(term => folded.includes(term)); };

const SNIPPET_BEFORE = 14, SNIPPET_LENGTH = 48;
/** The line around the first word found in an answer, without Markdown marks. */
function snippetOf(body: string, terms: readonly string[]): string | undefined {
  const plain = body.replace(/```[^\n]*\n?/gu, " ").replace(/[*_#>`|]+/gu, " ").replace(/\s+/gu, " ").trim(), folded = fold(plain);
  const at = Math.min(...terms.map(term => folded.indexOf(term)).filter(index => index >= 0));
  if (!Number.isFinite(at)) return undefined;
  const start = Math.max(0, at - SNIPPET_BEFORE), end = Math.min(plain.length, start + SNIPPET_LENGTH);
  return `${start ? "…" : ""}${plain.slice(start, end).trim()}${end < plain.length ? "…" : ""}`;
}
/** Occurrences of the words in a text: an answer about the word outranks one naming it in passing. */
function hits(text: string, terms: readonly string[]): number {
  const folded = fold(text);
  return terms.reduce((sum, term) => sum + folded.split(term).length - 1, 0);
}

/** The questions matching a query, best first: those whose title or question has every word, in reading order; then
 * those whose answer completes it, most mentions first, each with the line it was found in. */
export function rankQuestionMatches(ids: readonly string[], texts: ReadonlyMap<string, QuestionText>, query: string): QuestionMatch[] {
  const terms = questionSearchTerms(query);
  if (!terms.length) return ids.map(id => ({ id, inQuestion: true }));
  const asked: QuestionMatch[] = [], answered: Array<QuestionMatch & { score: number; order: number }> = [];
  ids.forEach((id, order) => {
    const text = texts.get(id);
    if (!text || !matchesTerms(`${text.head} ${text.body}`, terms)) return;
    if (matchesTerms(text.head, terms)) { asked.push({ id, inQuestion: true }); return; }
    answered.push({ id, inQuestion: false, snippet: snippetOf(text.body, terms.filter(term => !fold(text.head).includes(term))), score: hits(text.body, terms), order });
  });
  answered.sort((a, b) => b.score - a.score || a.order - b.order);
  return [...asked, ...answered.map(({ id, inQuestion, snippet }) => ({ id, inQuestion, snippet }))];
}
