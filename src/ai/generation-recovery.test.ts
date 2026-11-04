import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import type { AtlasAI } from "./atlas-ai";
import type { StructuredAIRequest } from "./provider";
import type { ConversationMessage } from "../shared/types";
import { projectSession } from "../test/project-fixture";
import { verifyWikiDraft } from "./wiki-verification";
import { groundWikiClaims } from "../shared/wiki-claims";
import { requestBudget } from "./request-policy";

const raw = (id: string, content: string, messageIndex = 0): ConversationMessage => ({ id, content, conversationId: "source", messageIndex, role: "assistant", createdAt: 1, updatedAt: 1, preview: "", contentHash: "" });

it("retains successful reviewed chapters when another correction fails, then retries only the pending chapter", async () => {
  const session = projectSession(), original = raw("message", "建议采用 BYOK。尚未完成发布。");
  session.sections = ["good", "bad"].map(id => ({ ...session.sections[0], id, body: "已采用 BYOK。", claims: [{ text: "已采用 BYOK", quote: "建议采用 BYOK。", evidenceIds: ["e1"] }] }));
  session.sections = groundWikiClaims(session.sections, session.evidence, [original]);
  const synthesize = vi.fn(async (request: StructuredAIRequest<unknown>) => {
    const data = JSON.parse(request.prompt);
    if (data.presentation === "wiki_claim_correction") throw new Error("connection failed");
    return request.validate({ checks: data.facts.map((fact: { key: string }) => ({ key: fact.key, verdict: fact.key.startsWith("bad") ? "unsupported" : "supported" })) });
  });
  const ai = { modelId: "fixture", synthesize } as unknown as AtlasAI;
  const draft = await verifyWikiDraft(session, [original], ai, new AbortController().signal);
  expect(draft.sections[0].evidenceReview?.status).toBe("verified"); expect(draft.sections[0].reviewIssue).toBeUndefined();
  expect(draft.sections[1].reviewIssue).toBeTruthy(); expect(draft.sections[1].claims?.[0].verification).toBe("uncertain");
  synthesize.mockClear(); await verifyWikiDraft(draft, [original], ai, new AbortController().signal);
  expect(synthesize.mock.calls.every(([request]) => !JSON.parse(request.prompt).facts.some((fact: { key: string }) => fact.key.startsWith("good")))).toBe(true);
});

it("repairs repeated contradictions in bounded paragraphs without overwriting earlier claim repairs", async () => {
  const session = projectSession();
  const original = raw("message", "建议采用 BYOK。电气验证尚未完成。");
  const first = "已采用 BYOK", second = "电气验证已完成";
  session.sections = [{ ...session.sections[0], body: Array.from({ length: 12 }, (_, index) => `${index % 2 ? second : first}。${"这里讨论设计边界和预期效果。".repeat(62)}`).join("\n\n"), claims: [{ text: first, quote: "建议采用 BYOK。", evidenceIds: ["e1"] }, { text: second, quote: "电气验证尚未完成。", evidenceIds: ["e1"] }] }];
  session.sections = groundWikiClaims(session.sections, session.evidence, [original]);
  let correctedRequests = 0;
  const synthesize = vi.fn(async (request: StructuredAIRequest<unknown>) => {
    const data = JSON.parse(request.prompt);
    expect(requestBudget(request, "fixture").inputTokens).toBeLessThanOrEqual(6000);
    if (data.presentation === "wiki_claim_correction") {
      correctedRequests++;
      return request.validate({ patches: data.facts.map((fact: { key: string; claim: { text: string; quote: string; evidenceIds: string[] } }) => ({ key: fact.key, claim: { ...fact.claim, text: fact.claim.text === first ? "建议采用 BYOK" : "电气验证尚未完成" } })), edits: data.editableParagraphs.map((block: { id: string; text: string }) => ({ id: block.id, text: data.facts[0].claim.text === first ? block.text.replaceAll(first, "建议采用 BYOK") : block.text.replaceAll(second, "电气验证尚未完成") })) });
    }
    return request.validate({ checks: data.facts.map((fact: { key: string }) => ({ key: fact.key, verdict: data.renderedSections ? "supported" : "unsupported", reason: "计划不能视为完成" })) });
  });
  const draft = await verifyWikiDraft(session, [original], { modelId: "fixture", synthesize } as unknown as AtlasAI, new AbortController().signal);
  expect(draft.sections[0].reviewIssue).toBeUndefined();
  expect(draft.sections[0].body).not.toContain(first); expect(draft.sections[0].body).not.toContain(second);
  expect(draft.sections[0].claims?.map(claim => claim.text)).toEqual(["建议采用 BYOK", "电气验证尚未完成"]);
  expect(draft.sections[0].evidenceReview?.status).toBe("verified"); expect(correctedRequests).toBeGreaterThan(2);
});

it("marks model-service verification failures as retryable chapter drafts", async () => {
  const session = projectSession(), original = raw("message", "建议采用 BYOK。");
  session.sections[0].claims = [{ text: "建议采用 BYOK", quote: original.content, evidenceIds: ["e1"] }];
  session.sections = groundWikiClaims(session.sections, session.evidence, [original]);
  const draft = await verifyWikiDraft(session, [original], { synthesize: async () => { throw new Error("timeout"); } } as unknown as AtlasAI, new AbortController().signal);
  expect(draft.sections[0].reviewIssue).toContain("核验请求未完成");
});
