import type { WikiAnswerAction, WikiScopeAnswer, WikiWritingQuestion } from "../shared/wiki-knowledge";

/** Questions a model asks the user about the material, read from its answer: ids it was sent, answers from the actions
 * the ledger keeps, at least two answers each, nothing asked twice. Never throws: no questions is a valid answer.
 * real: the ids the model saw → unit ids. prefix tells questions asked before writing from those asked while writing. */
const ACTIONS = new Set(["confirm", "reject", "open", "both", "owner"]), OWNER_ANSWERS = new Set<WikiScopeAnswer>(["exclude", "related", "reference", "project"]), MAX_OPTIONS = 4;
const ALIAS = /\bk\d+\b/u;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
export function readQuestions(value: unknown, real: Map<string, string>, organization: number, options: { prefix?: string; limit?: number; stage?: "writing" } = {}): WikiWritingQuestion[] {
  const raw = (value as { questions?: unknown })?.questions, limit = options.limit ?? 6;
  if (!Array.isArray(raw)) return [];
  const asked = new Set<string>(), questions: WikiWritingQuestion[] = [];
  for (const item of raw.slice(0, limit * 2)) {
    const question = item as { about?: unknown; ask?: unknown; unitIds?: unknown; options?: unknown };
    const about = text(question.about, 24), ask = text(question.ask, 120);
    const unitIds = (Array.isArray(question.unitIds) ? question.unitIds : []).flatMap(id => typeof id === "string" && real.has(id) ? [real.get(id)!] : []);
    // An id the model was sent (k78) means nothing to the user, and came back inside one answer they chose.
    if (!about || !ask || !unitIds.length || !Array.isArray(question.options) || ALIAS.test(`${about} ${ask}`)) continue;
    const key = [...new Set(unitIds)].sort().join("|");
    if (asked.has(key)) continue;
    const answers = question.options.slice(0, MAX_OPTIONS).flatMap((option, index) => {
      const label = text((option as { label?: unknown })?.label, 60);
      if (!label || ALIAS.test(label)) return [];
      const actions = (Array.isArray((option as { actions?: unknown }).actions) ? (option as { actions: unknown[] }).actions : []).flatMap((action): WikiAnswerAction[] => {
        const entry = action as { do?: unknown; units?: unknown; name?: unknown; answer?: unknown };
        const units = (Array.isArray(entry.units) ? entry.units : []).flatMap(id => typeof id === "string" && real.has(id) ? [real.get(id)!] : []);
        if (typeof entry.do !== "string" || !ACTIONS.has(entry.do) || !units.length) return [];
        if (entry.do === "both") return units.length === 2 ? [{ do: "both", units: [units[0], units[1]] }] : [];
        if (entry.do === "owner") { const name = text(entry.name, 40), answer = entry.answer as WikiScopeAnswer; return name && OWNER_ANSWERS.has(answer) ? [{ do: "owner", units, name, answer }] : []; }
        return [{ do: entry.do as "confirm" | "reject" | "open", units }];
      });
      return [{ id: `o${index + 1}`, label, actions }];
    });
    if (answers.length < 2) continue;
    asked.add(key);
    questions.push({ id: `ask:${organization}:${options.prefix ? `${options.prefix}:` : ""}${questions.length + 1}`, about, ask, unitIds: [...new Set(unitIds)], options: answers, organization, ...(options.stage ? { stage: options.stage } : {}) });
    if (questions.length >= limit) break;
  }
  return questions;
}
