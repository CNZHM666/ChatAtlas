import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { buildKnowledgeIndex } from "../shared/knowledge-index";
import { reconcileWikiTopics, validateTopicImpacts } from "./wiki-topic-update";
import { mergeFocusUpdate, planFocusUpdate } from "./focus-update";
import { getDatabase } from "../storage/db";
import { generateFocusSession } from "./focus-session";
import { createAtlasAI } from "./atlas-ai";
import { requestMessages, validateProviderOutput } from "./request-policy";
import { sourceMessageSignature } from "../shared/source-signature";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
vi.mock("./focus-session", () => ({ generateFocusSession: vi.fn() }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: vi.fn() }));
const raw = (id: string, content: string): ConversationMessage => ({ id, conversationId: id, messageIndex: 0, role: "user", content, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
const messages = [raw("old-source", "原来选择平台统一 API。"), raw("new-source", "改为用户自行配置 API，降低维护成本。")];
const previous: FocusSession = { id: "old", goal: "整理项目", mode: "work", title: "Project", locale: "zh-CN", scope: { kind: "all" }, sourceConversationIds: ["old-source"], sourceSignatures: { "old-source": { "old-source": sourceMessageSignature(messages[0].content) } }, sourceMessageOrder: { "old-source": ["old-source"] }, sourceRoles: { "old-source": { "old-source": "user" } }, coverage: { method: "full_direct", sourceCount: 1, processedSegments: 1, totalSegments: 1 }, sections: [{ id: "api", title: "模型接入", body: "当前采用平台统一 API。", kind: "finding", transition: "", evidenceIds: ["e0"], claims: [{ text: "平台统一 API", quote: messages[0].content, evidenceIds: ["e0"] }] }], evidence: [{ id: "e0", conversationId: "old-source", messageId: "old-source", title: "Old", excerpt: messages[0].content }], activeSectionId: "api", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
const patch: FocusSession = { ...previous, id: "patch", sourceConversationIds: ["new-source"], sections: [{ id: "new-page", title: "为什么选择 BYOK", body: "改为 BYOK。", kind: "finding", transition: "", evidenceIds: ["e1"] }], evidence: [{ id: "e1", conversationId: "new-source", messageId: "new-source", title: "New", excerpt: messages[1].content }] };
const sources = messages.map(message => ({ id: message.conversationId, title: message.id, platform: "chatgpt" as const, url: "", messageCount: 1, updatedAt: 1 }));
beforeEach(async () => { vi.clearAllMocks(); const db = await getDatabase(); await db.clear("messages"); await db.clear("aiSettings"); for (const message of messages) await db.put("messages", message); await db.put("aiSettings", { id: "ai-settings", provider: "openai", model: "fixture", apiKey: "fixture", baseUrl: "https://fixture.example/v1", updatedAt: 1 }); });
it("revisits a changed decision across conversations and updates the same canonical page from both originals", async () => {
  const decide = vi.fn().mockResolvedValue([{ sectionId: "api", patchSectionIds: ["new-page"] }]);
  vi.mocked(createAtlasAI).mockReturnValue({ decide, modelId: "fixture" } as never);
  vi.mocked(generateFocusSession).mockResolvedValue({ ...patch, sections: [{ ...patch.sections[0], id: "api", title: "模型接入", body: "原先平台统一 API；后来改为 BYOK，降低维护成本。" }] });
  const topics = await reconcileWikiTopics(previous, patch, messages, sources, new AbortController().signal);
  const plan = planFocusUpdate(previous, messages); plan.affectedSectionIds.push(...topics.affectedIds);
  const merged = mergeFocusUpdate(previous, topics.patch, plan, messages, "zh-CN");
  expect(merged.sections).toHaveLength(1); expect(merged.sections[0]).toMatchObject({ id: "api", body: expect.stringContaining("后来改为 BYOK") });
  expect(merged.previousSessionId).toBe("old"); expect(previous.sections[0].body).toBe("当前采用平台统一 API。");
  const options = vi.mocked(generateFocusSession).mock.calls[0][9];
  expect(options?.scope?.blocks?.flatMap(block => block.messageIds)).toEqual(["old-source", "new-source"]);
});
it("keeps a personal page canonical and saves new discussion as a separate suggestion", async () => {
  vi.mocked(createAtlasAI).mockReturnValue({ decide: async () => [{ sectionId: "api", patchSectionIds: ["new-page"] }], modelId: "fixture" } as never);
  const edited = { ...previous, sections: [{ ...previous.sections[0], body: "我的解释", userEdited: true }] };
  const topics = await reconcileWikiTopics(edited, patch, messages, sources, new AbortController().signal);
  expect(generateFocusSession).not.toHaveBeenCalled();
  expect(topics.patch.sections).toEqual([]);
  const plan = planFocusUpdate(edited, messages); plan.affectedSectionIds.push(...topics.affectedIds);
  const merged = mergeFocusUpdate(edited, topics.patch, plan, messages, "zh-CN");
  expect(merged.sections).toHaveLength(1); expect(merged.sections[0].body).toBe("我的解释");
  expect(merged.wikiSuggestions?.api.body).toBe("改为 BYOK。");
  expect(merged.evidence.some(ref => ref.id === merged.wikiSuggestions?.api.evidenceIds[0])).toBe(true);
});
it("combines exact and semantic topic impacts without losing either new discussion", async () => {
  const extra = raw("supplement-source", "还增加了模型切换能力。");
  const expanded = { ...patch, sections: [{ ...patch.sections[0], title: "模型接入" }, { ...patch.sections[0], id: "supplement-page", title: "模型切换", evidenceIds: ["e2"] }], evidence: [...patch.evidence, { id: "e2", conversationId: extra.conversationId, messageId: extra.id, title: "Supplement", excerpt: extra.content }] };
  vi.mocked(createAtlasAI).mockReturnValue({ decide: async () => [{ sectionId: "api", patchSectionIds: ["supplement-page"] }], modelId: "fixture" } as never);
  vi.mocked(generateFocusSession).mockResolvedValue({ ...patch, sections: [{ ...patch.sections[0], id: "api" }] });
  await reconcileWikiTopics(previous, expanded, [...messages, extra], [...sources, { ...sources[0], id: extra.conversationId }], new AbortController().signal);
  expect(vi.mocked(generateFocusSession).mock.calls[0][9]?.scope?.blocks?.flatMap(block => block.messageIds)).toEqual(["old-source", "new-source", "supplement-source"]);
});
it("rejects a multi-page replacement instead of silently discarding generated content", async () => {
  vi.mocked(createAtlasAI).mockReturnValue({ decide: async () => [{ sectionId: "api", patchSectionIds: ["new-page"] }], modelId: "fixture" } as never);
  vi.mocked(generateFocusSession).mockResolvedValue({ ...patch, sections: [...patch.sections, { ...patch.sections[0], id: "unexpected-second-page" }] });
  await expect(reconcileWikiTopics(previous, patch, messages, sources, new AbortController().signal)).rejects.toThrow("one complete page");
  expect(previous.sections[0].body).toBe("当前采用平台统一 API。");
});
it("rejects topic plans selecting other projects or inventing pages", () => {
  expect(() => validateTopicImpacts({ updates: [{ sectionId: "foreign", patchSectionIds: ["new-page"] }] }, previous, patch)).toThrow();
  expect(() => validateTopicImpacts({ updates: [{ sectionId: "api", patchSectionIds: ["invented"] }] }, previous, patch)).toThrow();
});
it("indexes only literal original claim anchors with roles and content signatures", () => {
  const index = buildKnowledgeIndex(previous, messages);
  expect(index.facts[0].sources[0]).toMatchObject({ role: "user", signature: sourceMessageSignature(messages[0].content) });
  expect(index.dependencies.api).toEqual([JSON.stringify(["old-source", "old-source"])]);
  expect(buildKnowledgeIndex({ ...previous, sections: [{ ...previous.sections[0], userEdited: true }] }, messages).facts).toEqual([]);
  expect(buildKnowledgeIndex(previous, [raw("old-source", "已经变化的正文")]).facts).toEqual([]);
});
it("the actual provider request preserves Wiki guidance and restores claim-level IDs", () => {
  const data = { intent: "整理", mode: "work", strategy: "work", locale: "zh-CN", passages: [{ id: "original-id", text: "用户选择 BYOK。" }] };
  const request = { taskType: "focus_session" as const, system: "Keep a two-level directory; merge canonical topics; preserve original claims.", prompt: JSON.stringify(data), validate: (value: unknown) => value as { sections: Array<{ claims: Array<{ evidenceIds: string[] }> }> } };
  expect(requestMessages(request)[0].content).toContain("merge canonical topics");
  const result = validateProviderOutput(request, { title: "模型接入", sections: [{ title: "选择", body: "用户选择 BYOK。", transition: "", kind: "finding", evidenceIds: ["e1"], claims: [{ text: "BYOK", quote: "用户选择 BYOK。", evidenceIds: ["e1"] }] }] });
  expect(result.sections[0].claims[0].evidenceIds).toEqual(["original-id"]);
});
