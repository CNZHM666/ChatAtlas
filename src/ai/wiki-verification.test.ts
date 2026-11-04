import { expect, it, vi } from "vitest";
import type { AtlasAI } from "./atlas-ai";
import type { StructuredAIRequest } from "./provider";
import type { ConversationMessage } from "../shared/types";
import { projectSession } from "../test/project-fixture";
import { groundWikiClaims, wikiQuoteRange } from "../shared/wiki-claims";
import { verifyWikiClaims } from "./wiki-verification";
import { requestBudget } from "./request-policy";
import { AIProviderHttpError, AIProviderResponseError } from "./provider-errors";

const message: ConversationMessage = { id: "raw", conversationId: "source", messageIndex: 0, role: "assistant", content: "建议采用 BYOK。尚未完成发布。", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 };
function session() {
  const base = projectSession();
  base.evidence = [{ id: "e1", conversationId: "source", messageId: "raw", title: "方案", excerpt: message.content }];
  base.sections = [{ id: "wiki", title: "接入", body: "已采用 BYOK。", kind: "finding", transition: "", evidenceIds: ["e1"], claims: [{ text: "已采用 BYOK", quote: "建议采用 BYOK。", evidenceIds: ["e1"] }] }];
  base.sections = groundWikiClaims(base.sections, base.evidence, [message]); return base;
}
function reviewer(verdict: string) {
  const synthesize = vi.fn(async (request: StructuredAIRequest<unknown>) => request.validate({ checks: JSON.parse(request.prompt).facts.map((fact: { key: string }) => ({ key: fact.key, verdict })) }));
  return { synthesize, modelId: "fixture", discardFinalSynthesis: vi.fn(async () => undefined) } as unknown as AtlasAI;
}
it("rejects an exact quotation that does not substantiate the claimed user decision and invalidates only its final synthesis", async () => {
  const ai = reviewer("unsupported");
  await expect(verifyWikiClaims(session(), [message], ai, new AbortController().signal)).rejects.toThrow("原文依据不符");
  expect(ai.discardFinalSynthesis).toHaveBeenCalledOnce();
  const request = vi.mocked(ai.synthesize).mock.calls[0][0];
  expect(request.cacheIf?.([{ key: "wiki:0", verdict: "unsupported" }])).toBe(false);
  expect(JSON.parse(request.prompt).originalPassages[0]).toMatchObject({ role: "assistant", text: message.content });
});
it("retains uncertain interpretations for review instead of certifying them", async () => {
  const next = await verifyWikiClaims(session(), [message], reviewer("uncertain"), new AbortController().signal);
  expect(next.sections[0].claims?.[0].verification).toBe("uncertain");
  expect(next.sections[0].evidenceReview).toMatchObject({ status: "partial", checkedClaims: 1 });
});
it("records missing or forged anchors and skips a paid check when no valid claims remain", async () => {
  const base = session(); base.sections[0].claims![0].quote = "已完成全部发布";
  base.sections = groundWikiClaims(base.sections, base.evidence, [message]);
  const ai = reviewer("supported"); await verifyWikiClaims(base, [message], ai, new AbortController().signal);
  expect(ai.synthesize).not.toHaveBeenCalled();
  expect(base.sections[0].evidenceReview).toMatchObject({ invalidClaims: 1, status: "unanchored" });
});
it("bounds review to twelve important claims and does not mark unreviewed claims verified", async () => {
  const base = session(); base.sections[0].claims = Array.from({ length: 20 }, (_, index) => ({ text: `第${index}版采用 BYOK`, quote: "建议采用 BYOK。", evidenceIds: ["e1"] }));
  base.sections = groundWikiClaims(base.sections, base.evidence, [message]);
  const ai = reviewer("supported"), next = await verifyWikiClaims(base, [message], ai, new AbortController().signal);
  expect(JSON.parse(vi.mocked(ai.synthesize).mock.calls[0][0].prompt).facts).toHaveLength(12);
  expect(next.sections[0].evidenceReview).toMatchObject({ status: "partial", checkedClaims: 12 });
});
it("preserves an explicitly incomplete review when the verification provider times out", async () => {
  const ai = reviewer("supported"); vi.mocked(ai.synthesize).mockRejectedValue(new Error("timeout"));
  const next = await verifyWikiClaims(session(), [message], ai, new AbortController().signal);
  expect(next.sections[0].evidenceReview).toMatchObject({ status: "partial", checkedClaims: 0 });
  expect(ai.discardFinalSynthesis).not.toHaveBeenCalled();
});

it("reviews the actual deep-message passage when the quote folds whitespace, including unicode", async () => {
  const raw = { ...message, content: "开头的无关讨论。".repeat(300) + "建议采用\n  BYOK。尚未完成发布。😀" };
  const base = session(); base.sections = groundWikiClaims(base.sections, base.evidence, [raw]);
  const ai = reviewer("uncertain"); await verifyWikiClaims(base, [raw], ai, new AbortController().signal);
  const source = JSON.parse(vi.mocked(ai.synthesize).mock.calls[0][0].prompt).originalPassages[0];
  expect(source.text).toContain("建议采用\n  BYOK。尚未完成发布。");
  const range = wikiQuoteRange("😀 建议采用\n BYOK。", "建议采用 BYOK。");
  expect("😀 建议采用\n BYOK。".slice(range!.start, range!.end)).toBe("建议采用\n BYOK。");
  expect(wikiQuoteRange(raw.content, "  ")).toBeUndefined();
});

function correctingReviewer(finalVerdict = "supported", correctedBody = "建议采用 BYOK，尚未完成发布。") {
  const ai = reviewer("supported");
  let reviews = 0;
  vi.mocked(ai.synthesize).mockImplementation(async request => {
    const input = JSON.parse(request.prompt);
    if (input.presentation === "wiki_claim_correction") return request.validate({ patches: [{ key: "wiki:0", claim: { text: "建议采用 BYOK，尚未完成发布", quote: message.content, evidenceIds: ["e1"] } }], edits: [{ id: input.editableParagraphs[0].id, text: correctedBody }] });
    reviews++;
    return request.validate({ checks: input.facts.map((fact: { key: string }) => ({ key: fact.key, verdict: reviews === 1 ? "unsupported" : finalVerdict, reason: "原文是建议，未确认采用" })) });
  });
  return ai;
}

it("corrects only the contradicted draft section and independently reviews its rendered body", async () => {
  const base = session(), untouched = { ...base.sections[0], id: "personal", userEdited: true, body: "我的原记录" };
  base.sections.push(untouched);
  const ai = correctingReviewer();
  const next = await verifyWikiClaims(base, [message], ai, new AbortController().signal);
  expect(next.sections[0].body).toBe("建议采用 BYOK，尚未完成发布。");
  expect(next.sections[0].evidenceReview?.status).toBe("verified");
  expect(next.sections[1]).toBe(untouched);
  expect(base.sections[0].body).toBe("已采用 BYOK。");
  expect(ai.synthesize).toHaveBeenCalledTimes(3);
  const requests = vi.mocked(ai.synthesize).mock.calls.map(([request]) => JSON.parse(request.prompt));
  expect(requests[1].editableParagraphs.map((paragraph: { sectionId: string }) => paragraph.sectionId)).toEqual(["wiki"]);
  expect(requests[2].renderedSections).toEqual([{ id: "wiki", passages: [{ id: "wiki:block:0", body: next.sections[0].body }] }]);
  expect(requests[2].previousFeedback).toEqual([{ key: "wiki:0", verdict: "unsupported", reason: "原文是建议，未确认采用" }]);
  const repair = vi.mocked(ai.synthesize).mock.calls[1][0];
  expect(repair.bypassCache).not.toBe(true);
  expect(repair.cacheIf?.(undefined)).toBe(false);
  expect(repair.cacheIf?.({ sections: next.sections, blocks: [{}] })).toBe(true);
});

it("does not loop or publish a correction that still contradicts the original", async () => {
  const ai = correctingReviewer("unsupported", "已确认采用 BYOK。");
  await expect(verifyWikiClaims(session(), [message], ai, new AbortController().signal)).rejects.toThrow("原文是建议，未确认采用");
  expect(ai.synthesize).toHaveBeenCalledTimes(3);
});

it("does not publish a corrected section when its second verification times out", async () => {
  const ai = correctingReviewer();
  const synthesize = ai.synthesize;
  vi.mocked(ai.synthesize).mockImplementationOnce(async request => request.validate({ checks: [{ key: "wiki:0", verdict: "unsupported" }] }));
  // The next two calls are explicitly controlled, rather than a recursive retry.
  vi.mocked(ai.synthesize).mockImplementationOnce(async request => request.validate({ patches: [{ key: "wiki:0", claim: { text: "建议采用 BYOK", quote: "建议采用 BYOK。", evidenceIds: ["e1"] } }], edits: [{ id: JSON.parse(request.prompt).editableParagraphs[0].id, text: "建议采用 BYOK。" }] }));
  vi.mocked(synthesize).mockRejectedValueOnce(new Error("timeout"));
  await expect(verifyWikiClaims(session(), [message], ai, new AbortController().signal)).rejects.toThrow("暂未完成复核");
});

it.each([{ claims: [] }, { claims: [{ text: "已完成发布", quote: "虚构引文", evidenceIds: ["e1"] }] }, { claims: [{ text: "已完成发布", quote: message.content, evidenceIds: ["foreign"] }] }])("rejects correction attempts with missing, forged or foreign anchors", async ({ claims }) => {
  const ai = reviewer("unsupported");
  vi.mocked(ai.synthesize).mockImplementation(async request => JSON.parse(request.prompt).presentation === "wiki_claim_correction" ? request.validate({ patches: claims.map(claim => ({ key: "wiki:0", claim })), edits: [{ id: JSON.parse(request.prompt).editableParagraphs[0].id, text: "已完成发布" }] }) : request.validate({ checks: [{ key: "wiki:0", verdict: "unsupported" }] }));
  await expect(verifyWikiClaims(session(), [message], ai, new AbortController().signal)).rejects.toThrow("局部纠正未完成");
  expect(ai.synthesize).toHaveBeenCalledTimes(2);
});

it("does not make a review request after cancellation", async () => {
  const controller = new AbortController(), ai = reviewer("supported"); controller.abort();
  await expect(verifyWikiClaims(session(), [message], ai, controller.signal)).rejects.toThrow();
  expect(ai.synthesize).not.toHaveBeenCalled();
});

it("corrects the Stage 3/Stage 4 mixup in a long chapter without rewriting unrelated paragraphs or anchors", async () => {
  const raw = { ...message, content: "### Stage 3 · 方案草稿\n先形成方案草稿。\n\n### Stage 4 · 库存检查\n询问‘你已经有这些吗？’，然后嵌入 Visual Inventory。" };
  const bad = "确定在方案阶段嵌入 Visual Inventory。", good = "建议在方案草稿之后的 Stage 4 库存检查中，询问‘你已经有这些吗？’再嵌入 Visual Inventory。";
  const base = session();
  base.sections[0] = { ...base.sections[0], title: "用户旅程重构与交互规范", body: Array.from({ length: 70 }, (_, index) => `第${index}项原有说明：${"保持原有内容和层级。".repeat(12)}`).join("\n\n") + `\n\n${bad}\n\n保留末尾的验收要求。`, claims: [{ text: bad, quote: "询问‘你已经有这些吗？’，然后嵌入 Visual Inventory。", evidenceIds: ["e1"] }, { text: "建议采用 BYOK", quote: message.content, evidenceIds: ["e2"] }], evidenceIds: ["e1", "e2"] };
  base.evidence.push({ id: "e2", conversationId: "source", messageId: "other", title: "安全", excerpt: message.content });
  const other = { ...message, id: "other", messageIndex: 1 };
  base.sections = groundWikiClaims(base.sections, base.evidence, [raw, other]);
  const ai = reviewer("supported"); let reviews = 0;
  vi.mocked(ai.synthesize).mockImplementation(async request => {
    const input = JSON.parse(request.prompt);
    if (input.presentation === "wiki_claim_correction") {
      expect(input.facts).toHaveLength(1);
      expect(input.editableParagraphs.some((paragraph: { text: string }) => paragraph.text.includes("第0项原有说明"))).toBe(false);
      expect(input.originalPassages[0].text).toContain("Stage 3");
      expect(input.originalPassages[0].text).toContain("Stage 4");
      expect(requestBudget(request, ai.modelId).inputTokens).toBeLessThanOrEqual(6000);
      return request.validate({ patches: [{ key: "wiki:0", claim: { text: good, quote: "询问‘你已经有这些吗？’，然后嵌入 Visual Inventory。", evidenceIds: ["e1"] } }], edits: input.editableParagraphs.map((paragraph: { id: string; text: string }) => ({ id: paragraph.id, text: paragraph.text.replace(bad, good) })) });
    }
    reviews++;
    if (reviews === 2) {
      expect(input.facts).toHaveLength(1);
      expect(input.renderedSections[0].passages.some((paragraph: { body: string }) => paragraph.body.includes(good))).toBe(true);
      expect(requestBudget(request, ai.modelId).inputTokens).toBeLessThanOrEqual(6000);
    }
    return request.validate({ checks: input.facts.map((fact: { key: string }) => ({ key: fact.key, verdict: reviews === 1 && fact.key === "wiki:0" ? "unsupported" : "supported", reason: "原文在方案草稿之后的 Stage 4，并非方案阶段" })) });
  });
  const result = await verifyWikiClaims(base, [raw, other], ai, new AbortController().signal);
  expect(result.sections[0].body).toBe(base.sections[0].body.replace(bad, good));
  expect(result.sections[0].claims?.[1]).toMatchObject({ text: "建议采用 BYOK", quote: message.content, evidenceIds: ["e2"] });
  expect(result.sections[0].evidenceReview).toMatchObject({ checkedClaims: 2, totalClaims: 2, status: "verified" });
  expect(base.sections[0].body).toContain(bad);
  expect(ai.synthesize).toHaveBeenCalledTimes(3);
});

it("retains stage heading context beyond the quote window in a long original message", async () => {
  const raw = { ...message, content: "### Stage 3 · 方案草稿\n" + "形成草稿的说明。".repeat(400) + "\n\n### Stage 4 · 库存检查\n" + "库存检查的说明。".repeat(400) + "\n建议采用 BYOK。尚未完成发布。" };
  const ai = reviewer("uncertain");
  await verifyWikiClaims(session(), [raw], ai, new AbortController().signal);
  const source = JSON.parse(vi.mocked(ai.synthesize).mock.calls[0][0].prompt).originalPassages[0];
  expect(source.text).not.toContain("Stage 3");
  expect(source.headings.map((heading: { text: string }) => heading.text)).toEqual(["### Stage 3 · 方案草稿", "### Stage 4 · 库存检查"]);
});

it("never accepts deleting the contradicted paragraph, editing an unsupplied block or leaving the body unchanged", async () => {
  for (const edit of [{ id: "wiki:block:0", text: "" }, { id: "personal:block:0", text: "建议采用 BYOK。" }, { id: "wiki:block:0", text: "已采用 BYOK。" }]) {
    const ai = reviewer("unsupported");
    vi.mocked(ai.synthesize).mockImplementation(async request => JSON.parse(request.prompt).presentation === "wiki_claim_correction" ? request.validate({ patches: [{ key: "wiki:0", claim: { text: "建议采用 BYOK", quote: "建议采用 BYOK。", evidenceIds: ["e1"] } }], edits: [edit] }) : request.validate({ checks: [{ key: "wiki:0", verdict: "unsupported" }] }));
    await expect(verifyWikiClaims(session(), [message], ai, new AbortController().signal)).rejects.toThrow("局部纠正未完成");
    expect(ai.synthesize).toHaveBeenCalledTimes(2);
  }
});

it("does not auto-correct personal sections or interpret cancellation as a correction failure", async () => {
  const base = session(); base.sections[0].userEdited = true;
  const ai = reviewer("unsupported");
  await verifyWikiClaims(base, [message], ai, new AbortController().signal);
  expect(ai.synthesize).not.toHaveBeenCalled();
  const controller = new AbortController();
  vi.mocked(ai.synthesize).mockImplementation(async request => {
    if (JSON.parse(request.prompt).presentation === "wiki_claim_correction") { controller.abort(new Error("user cancelled")); throw controller.signal.reason; }
    return request.validate({ checks: [{ key: "wiki:0", verdict: "unsupported" }] });
  });
  await expect(verifyWikiClaims(session(), [message], ai, controller.signal)).rejects.toThrow("user cancelled");
  expect(ai.synthesize).toHaveBeenCalledTimes(2);
});

it("can correct a wrong citation using a relevant original already bound to the chapter without expanding source scope", async () => {
  const base = session();
  base.sections[0].body = "确定在方案阶段嵌入 Visual Inventory。";
  base.sections[0].claims = [{ text: base.sections[0].body, quote: "形成方案草稿。", evidenceIds: ["e1"] }];
  base.sections[0].evidenceIds.push("e2");
  base.evidence.push({ id: "e2", conversationId: "source", messageId: "stage4", title: "库存检查", excerpt: "Stage 4" });
  const draft = { ...message, content: "Stage 3：形成方案草稿。" }, inventory = { ...message, id: "stage4", messageIndex: 1, content: "Stage 4：方案草稿之后，询问你已经有这些吗，再嵌入 Visual Inventory。" };
  const outside = { ...message, conversationId: "outside", id: "not-selected", content: "Visual Inventory 随时打开。" };
  const ai = reviewer("supported"); let reviewed = false;
  vi.mocked(ai.synthesize).mockImplementation(async request => {
    const input = JSON.parse(request.prompt);
    if (input.presentation === "wiki_claim_correction") {
      expect(input.originalPassages.map((source: { id: string }) => source.id)).toEqual(["e1", "e2"]);
      expect(input.originalPassages.some((source: { conversationId: string }) => source.conversationId === "outside")).toBe(false);
      return request.validate({ patches: [{ key: "wiki:0", claim: { text: "建议在方案草稿之后的库存检查阶段嵌入 Visual Inventory", quote: inventory.content, evidenceIds: ["e2"] } }], edits: [{ id: input.editableParagraphs[0].id, text: "建议在方案草稿之后的库存检查阶段嵌入 Visual Inventory。" }] });
    }
    const verdict = reviewed ? "supported" : "unsupported"; reviewed = true;
    return request.validate({ checks: input.facts.map((fact: { key: string }) => ({ key: fact.key, verdict })) });
  });
  base.sections = groundWikiClaims(base.sections, base.evidence, [draft, inventory]);
  const next = await verifyWikiClaims(base, [draft, inventory, outside], ai, new AbortController().signal);
  expect(next.sections[0].claims?.[0].evidenceIds).toEqual(["e2"]);
  expect(next.sections[0].evidenceReview?.status).toBe("verified");
  expect(next.sections[0].evidenceIds).toEqual(["e1", "e2"]);
});

it.each([
  { error: new AIProviderResponseError("PROVIDER_TIMEOUT"), explanation: "纠正请求等待模型超时" },
  { error: new AIProviderHttpError(429, ""), explanation: "HTTP 429" },
])("reports the actual correction request failure rather than another semantic mismatch: $explanation", async ({ error, explanation }) => {
  const ai = reviewer("unsupported");
  vi.mocked(ai.synthesize).mockImplementation(async request => {
    if (JSON.parse(request.prompt).presentation === "wiki_claim_correction") throw error;
    return request.validate({ checks: [{ key: "wiki:0", verdict: "unsupported" }] });
  });
  await expect(verifyWikiClaims(session(), [message], ai, new AbortController().signal)).rejects.toThrow(explanation);
  expect(ai.synthesize).toHaveBeenCalledTimes(2);
});

it("shares repeated source windows across twelve claims instead of dropping review coverage for duplicate material", async () => {
  const raw = { ...message, content: "原始讨论上下文。".repeat(180) + message.content };
  const base = session(); base.sections[0].claims = Array.from({ length: 12 }, (_, index) => ({ text: `第${index}阶段建议采用 BYOK`, quote: "建议采用 BYOK。", evidenceIds: ["e1"] }));
  base.sections = groundWikiClaims(base.sections, base.evidence, [raw]);
  const ai = reviewer("uncertain");
  await verifyWikiClaims(base, [raw], ai, new AbortController().signal);
  const input = JSON.parse(vi.mocked(ai.synthesize).mock.calls[0][0].prompt);
  expect(input.facts).toHaveLength(12);
  expect(input.originalPassages).toHaveLength(1);
  expect(input.facts.every((fact: { sourceKeys: string[] }) => fact.sourceKeys[0] === input.originalPassages[0].key)).toBe(true);
});

it("preserves paragraph separation when a model omits newlines from its replacement", async () => {
  const base = session();
  base.sections[0].body = "# 接入说明\n\n已采用 BYOK。\n\n# 验收要求\n\n保留全部验收说明。";
  const ai = correctingReviewer();
  const next = await verifyWikiClaims(base, [message], ai, new AbortController().signal);
  expect(next.sections[0].body).toBe("# 接入说明\n\n建议采用 BYOK，尚未完成发布。\n\n# 验收要求\n\n保留全部验收说明。");
});

it("independently reviews overview role and report status even without ordinary verification keywords",async()=>{const base=session();base.sections[0].claims![0]={text:"检索可用",quote:"建议采用 BYOK。",evidenceIds:["e1"],overviewRole:"progress",workStatus:"reported"};const ai=reviewer("uncertain");const next=await verifyWikiClaims(base,[message],ai,new AbortController().signal);expect(ai.synthesize).toHaveBeenCalledOnce();const request=vi.mocked(ai.synthesize).mock.calls[0][0];expect(JSON.parse(request.prompt).facts[0].claim).toMatchObject({overviewRole:"progress",workStatus:"reported"});expect(next.sections[0].claims?.[0].verification).toBe("uncertain");});
