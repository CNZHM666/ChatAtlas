import { expect, it } from "vitest";
import { buildKnowledgeIndex, knowledgeRevision } from "./knowledge-index";
import { projectSession } from "../test/project-fixture";
import type { ConversationMessage } from "./types";
import { sourceMessageSignature } from "./source-signature";

const content = "第二版：库存识别。新增库存比对。采购改为缺件清单。因为接口维护成本高。";
const original: ConversationMessage = { id: "message", conversationId: "source", messageIndex: 0, role: "assistant", content, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 };
function sessionWithHistory() {
  const session = projectSession(), evidenceIds = ["product-history:source:message"];
  session.projectState = undefined;
  session.projectHistoryAnalysis = { version: 1, signature: "s", sourceSignature: "raw", generatedAt: 1, sources: [], evidence: [{ ...session.evidence[0], id: evidenceIds[0], sourceSignature: sourceMessageSignature(content) }], events: [{ id: "history:inventory", title: "库存识别", version: "第二版", before: "", beforeQuote: "", beforeEvidenceIds: [], after: "识别库存，采购仅列缺件。", reason: "降低接口维护成本", status: "proposal", quote: "第二版：库存识别。", evidenceIds, additions: [{ text: "新增库存比对", quote: "新增库存比对。", evidenceIds }], modifications: [{ text: "采购范围缩小", quote: "采购改为缺件清单。", evidenceIds }], reasonQuote: "因为接口维护成本高。", reasonEvidenceIds: evidenceIds }] };
  return session;
}
it("indexes dedicated AI version details under their original quotes and existing Wiki pages", () => {
  const session = sessionWithHistory(), index = buildKnowledgeIndex(session, [original]);
  expect(index.facts).toHaveLength(4);
  expect(index.facts.map(fact => fact.quote)).toEqual(["第二版：库存识别。", "新增库存比对。", "采购改为缺件清单。", "因为接口维护成本高。"]);
  expect(index.facts.every(fact => fact.sectionId === "one" && fact.status === "proposal" && fact.topic === "version-history")).toBe(true);
  expect(index.facts[0].sources[0].role).toBe("assistant");
});
it("invalidates the knowledge revision after adopting history and rejects changed original text", () => {
  const session = sessionWithHistory();
  expect(knowledgeRevision(session)).not.toBe(knowledgeRevision({ ...session, projectHistoryAnalysis: undefined }));
  expect(buildKnowledgeIndex(session, [{ ...original, content: content + "来源已经更改" }]).facts).toEqual([]);
  const revision = knowledgeRevision(session);
  session.projectHistoryAnalysis!.events[0].modifications![0].text = "更新采购范围说明";
  expect(knowledgeRevision(session)).not.toBe(revision);
});
it("keeps an empty completed history analysis empty rather than falling back to an old state timeline", () => {
  const session = sessionWithHistory();
  session.projectState = projectSession().projectState; session.projectState!.verification = "original";
  session.projectState!.history = session.projectHistoryAnalysis!.events;
  session.projectHistoryAnalysis!.events = [];
  expect(buildKnowledgeIndex(session, [original]).facts.filter(fact => fact.topic === "version-history")).toEqual([]);
});
