import { expect, it } from "vitest";
import { loadFullReadingPassages } from "./focus-source-text";
import { projectQueryPassages } from "./project-query-materials";
import type { TranscriptPassage } from "../search/transcript-index";
const passage = (index: number, text: string): TranscriptPassage => ({ document: { id: `p${index}`, title: "Source", conversationId: "source", episodeId: "", body: text, terms: "" }, text, role: index % 2 ? "assistant" : "user", start: 0, end: text.length, evidence: { messageId: `m${index}`, messageIndex: index, excerpt: text } });
it("pins a semantic match in the middle of a long original even with no overlapping query keywords", () => {
  const target = "用户自行承担 API 使用费用，平台只提供连接方式。";
  const content = "无关背景。".repeat(850) + target.repeat(50) + "后续讨论。".repeat(400);
  const refs = [{ id: "semantic", conversationId: "source", messageId: "m1", title: "Source", excerpt: content.slice(3600, 5600) }];
  const result = projectQueryPassages("who pays", [passage(1, content)], refs);
  expect(result.some(item => item.text.includes(target))).toBe(true);
  expect(result.length).toBeLessThanOrEqual(12);
});
it("retrieves late relevant windows with adjacent context and bounded input", () => {
  const result = projectQueryPassages("pole stability", [passage(0, "other background ".repeat(8000)), passage(1, "pole stability condition"), passage(2, "later correction: conditional only")]);
  expect(result.some(item => item.text.includes("pole stability"))).toBe(true);
  expect(result.some(item => item.text.includes("later correction"))).toBe(true);
  expect(result.length).toBeLessThanOrEqual(12);
  expect(result.reduce((sum, item) => sum + item.document.body.length, 0)).toBeLessThan(24000);
});
it("does not fabricate adjacency across unselected discussion gaps or call a provider for no match", () => {
  const result = projectQueryPassages("stability", [passage(0, "stability condition"), passage(20, "unrelated chosen discussion")]);
  expect(result).toHaveLength(1); expect(result[0].after).toBe("");
  expect(projectQueryPassages("never-matching-topic", [passage(0, "stability")])).toEqual([]);
  expect(typeof loadFullReadingPassages).toBe("function");
});
it("reads model-selected discussion windows and their later corrections without widening scope", () => {
  const refs = [{ id: "r", conversationId: "source", messageId: "m1", title: "Source", excerpt: "" }];
  const result = projectQueryPassages("trajectory decay", [passage(1, "original assumption ".repeat(180) + "later correction: restricted to continuous time"), passage(2, "assistant response with required conditions")], refs);
  expect(result.some(item => item.text.includes("later correction"))).toBe(true);
  expect(result.some(item => item.text.includes("required conditions"))).toBe(true);
  expect(result.length).toBeLessThanOrEqual(12);
  expect(projectQueryPassages("no matching words", [passage(20, "allowed unrelated material")], refs)).toEqual([]);
});
it("reserves original questions when many answers compete for the bounded reading window", () => {
  const passages = Array.from({ length: 20 }, (_, index) => passage(index, index % 2 ? "方案回答与约束条件" : `方案问题 ${index}`));
  const refs = passages.filter(item => item.role === "assistant").map(item => ({ id: item.evidence.messageId, conversationId: "source", messageId: item.evidence.messageId, title: "Source", excerpt: "" }));
  const result = projectQueryPassages("最终方案", passages, refs);
  expect(result.length).toBeLessThanOrEqual(12); expect(result.filter(item => item.role === "assistant").length).toBeGreaterThan(0);
  for (const answer of result.filter(item => item.role === "assistant")) expect(result.some(item => item.evidence.messageIndex === answer.evidence.messageIndex - 1)).toBe(true);
});
