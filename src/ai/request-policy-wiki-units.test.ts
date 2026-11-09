import { expect, it } from "vitest";
import { requestBudget } from "./request-policy";

// The knowledge-unit pipeline asks each request for its own output limit; the policy caps it, so a task
// missing from the policy falls to the generic 520-token allowance and is cut off.
it("gives every knowledge-unit task the larger output allowance", () => {
  for (const presentation of ["wiki_unit_extract", "wiki_subject_attach", "wiki_subject_merge", "wiki_subject_split", "wiki_subject_same", "wiki_unit_merge", "wiki_unit_groups", "wiki_group_merge", "wiki_subject_plan", "wiki_subject_place", "wiki_unit_propositions", "wiki_chapter_write"])
    expect(requestBudget({ taskType: "other", system: "Return JSON.", prompt: JSON.stringify({ presentation, version: 1 }) }).maxOutputTokens, presentation).toBe(6000);
});

// One run's questions before writing were cut off at the generic allowance, and the fixed questions were asked instead.
it("gives the questions before writing room for six questions", () => {
  expect(requestBudget({ taskType: "other", system: "Return JSON.", prompt: JSON.stringify({ presentation: "wiki_writing_questions", version: 1 }) })).toMatchObject({ maxInputTokens: 16000, maxOutputTokens: 2600 });
});

it("gives one paragraph written again with the user's answers a small allowance", () => {
  expect(requestBudget({ taskType: "other", system: "Return JSON.", prompt: JSON.stringify({ presentation: "wiki_paragraph_revise", version: 1 }) })).toMatchObject({ maxInputTokens: 6000, maxOutputTokens: 1500 });
});

// A learning record's roles and card titles were cut off at 520 tokens: the titles stayed "第1课内容" and the roles fell
// back to guesses that made plans into cards.
it("gives a learning record's roles and card titles room for every point in the batch", () => {
  const budget = (presentation: string, key: string, count: number) => requestBudget({ taskType: "other", system: "Return JSON.", prompt: JSON.stringify({ presentation, version: 1, [key]: Array.from({ length: count }, (_, index) => ({ id: index })) }) }).maxOutputTokens;
  expect(budget("wiki_learning_roles", "units", 80)).toBe(3200);
  expect(budget("wiki_learning_card_titles", "cards", 30)).toBe(2600);
  expect(budget("wiki_learning_card_titles", "cards", 2)).toBe(800);
});
