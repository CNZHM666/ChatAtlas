import { expect, it } from "vitest";
import { wikiEvidencePoints } from "./wiki-evidence";
import { needsConfirmation } from "./workspace-evidence-context";
import { projectSession } from "../test/project-fixture";

it("opens the original that holds the claim's quote, whatever order the originals are listed in", () => {
  const session = projectSession();
  const other = { id: "a", conversationId: "c", messageId: "m-other", title: "", excerpt: "首页只保留搜索入口。" };
  const holding = { id: "b", conversationId: "c", messageId: "m-quote", title: "", excerpt: "我们决定索引使用 Orama 做全文检索。" };
  const section = { ...session.sections[0], evidenceIds: ["a", "b"], claims: [{ text: "索引使用 Orama 做全文检索。", quote: "索引使用 Orama 做全文检索", evidenceIds: ["a", "b"] }] };
  const [point] = wikiEvidencePoints(section, [other, holding], true);
  expect(point.reference.messageId).toBe("m-quote");
  // The quote is found, so the point needs no look for a missing quote.
  expect(point.quote).toBe("索引使用 Orama 做全文检索");
  expect(point.attention?.kind).not.toBe("missing");
});

it("takes a point the user answered out of the questions, whatever it was flagged for", () => {
  const session = projectSession();
  const source = { id: "a", conversationId: "c", messageId: "m", title: "", excerpt: "索引可以用 Orama。" };
  const claim = { text: "已决定索引使用 Orama。", quote: "索引可以用 Orama", evidenceIds: ["a"], workStatus: "proposed" as const, holder: "ai" as const, holderMark: true };
  const section = { ...session.sections[0], evidenceIds: ["a"], claims: [claim] };
  const [asked] = wikiEvidencePoints(section, [source], true);
  expect(asked.attention?.kind).toBe("settled");expect(needsConfirmation(asked)).toBe(true);
  const [answered] = wikiEvidencePoints({ ...section, claims: [{ ...claim, checked: true }] }, [source], true);
  expect(answered.checked).toBe(true);expect(needsConfirmation(answered)).toBe(false);
});

it("never asks about a table cell or a list of names for a negation its row's sentence holds", () => {
  const session = projectSession();
  const source = { id: "a", conversationId: "c", messageId: "m", title: "", excerpt: "Threadback、Echoes、LLM Wiki 已经覆盖跨平台搜索。单纯搜索或 Wiki 生成不再是独特优势。" };
  const quote = "Threadback、Echoes、LLM Wiki 已经覆盖跨平台搜索。单纯搜索或 Wiki 生成不再是独特优势。";
  const cell = { text: "Threadback, Echoes, LLM Wiki", quote, evidenceIds: ["a"] };
  // A sentence that drops the "不再" is still asked about.
  const sentence = { text: "单纯搜索或 Wiki 生成是 Atlas 的独特优势，应作为主要卖点。", quote, evidenceIds: ["a"] };
  const section = { ...session.sections[0], evidenceIds: ["a"], claims: [cell, sentence] };
  const points = wikiEvidencePoints(section, [source], true);
  expect(points.map(point => point.attention?.kind)).toEqual([undefined, "negation"]);
});
it("does not revive review tasks from the removed AI meaning check's stored verdicts", () => {
  const session = projectSession(), ref = { ...session.evidence[0], excerpt: "默认中性灰。" };
  const section = { ...session.sections[0], evidenceIds: [ref.id], claims: [{ text: "默认中性灰。", quote: "默认中性灰。", evidenceIds: [ref.id], meaning: { text: "默认中性灰。", verdict: "unsupported" as const, checkedAt: 1 } }] };
  expect(wikiEvidencePoints(section, [ref], true)[0].attention).toBeUndefined();
});
