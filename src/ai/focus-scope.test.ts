import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { StructuredAIRequest } from "./provider";
import { buildFocusScopeCandidates, confirmedFocusScope, scopedFocusPassages } from "./focus-scope";
import { loadFullReadingPassages } from "./focus-source-text";
import { generateFocusSession } from "./focus-session";
import { sourceReviewOutline } from "../canvas/source-review-outline";

const { synthesize } = vi.hoisted(() => ({ synthesize: vi.fn() }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: () => ({ synthesize }) }));
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ mode: "byok", provider: "qwen", apiKey: "test", baseUrl: "https://test.example/v1", model: "qwen3.8-flash" }) }));
vi.mock("./provider", async (original) => ({ ...await original<typeof import("./provider")>(), hasProviderPermission: async () => true }));
const source: Conversation = { id: "scope-source", title: "Control, Python and plots", platform: "chatgpt", url: "", messageCount: 10, updatedAt: 1 };
const contents = ["How do poles determine stability?", "Continuous systems need negative real parts.", "Why?", "Because the response decays with time.", "How do NumPy arrays work?", "Unrelated arrays and broadcasting.", "Correction to stability: what about discrete poles?", "Discrete poles must lie inside the unit circle.", "How do I plot a chart?", "Unrelated chart options."];
const messages: ConversationMessage[] = contents.map((content, index) => ({ id: `scope-${index}`, conversationId: source.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 }));
const goal = "Review stability";
const scopeFor = () => { const candidates = buildFocusScopeCandidates(goal, source, messages); return confirmedFocusScope(candidates, new Set(candidates.filter((item) => item.recommended).map((item) => item.id))); };
beforeEach(async () => {
  vi.clearAllMocks();
  const db = await getDatabase(); await db.clear("messages");
  for (const message of messages) await db.put("messages", message);
  synthesize.mockImplementation(async <T>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt);
    return request.validate({ title: "Stability", sections: [{ title: "Conditions and correction", body: "Review original conditions and the later correction.", transition: "", kind: "review", evidenceIds: data.passages.map((item: { id: string }) => item.id) }] });
  });
});

describe("confirmed topic scope", () => {
  it("retains complete turns, dependent follow-ups and a later return without unrelated topics", () => {
    const scope = scopeFor();
    expect(scope.blocks?.flatMap((block) => block.messageIds)).toEqual(["scope-0", "scope-1", "scope-2", "scope-3", "scope-6", "scope-7"]);
    expect(buildFocusScopeCandidates("Review thermodynamics", source, messages).some((item) => item.recommended)).toBe(false);
    const chinese = ["系统稳定性怎么判断？", "极点要满足稳定性条件。", "系统输入输出怎么定义？", "输入输出接口的定义。"].map((content, index) => ({ ...messages[index], content }));
    expect(buildFocusScopeCandidates("复习系统稳定性", source, chinese).filter((item) => item.recommended).flatMap((item) => item.messageIds)).toEqual(["scope-0", "scope-1"]);
  });
  it("sends only confirmed original ranges to AI, keeps full baseline freshness and marks partial structure", async () => {
    const scope = scopeFor();
    const result = await generateFocusSession(goal, "answer", [source], "en", new AbortController().signal, undefined, undefined, undefined, undefined, { scope });
    const payloads = synthesize.mock.calls.map(([request]) => JSON.parse(request.prompt));
    const raw = payloads.filter((data) => data.coverage.stage === "reading").flatMap((data) => data.passages);
    expect(raw).toHaveLength(6);
    expect(raw.map((item: { text: string }) => item.text).join("\n")).toContain("inside the unit circle");
    expect(raw.map((item: { text: string }) => item.text).join("\n")).not.toMatch(/NumPy|broadcasting|chart/);
    expect(payloads.at(-1).coverage.scope).toBe("goal");
    expect(synthesize).toHaveBeenCalledOnce();
    expect(result.coverage?.method).toBe("full_direct");
    expect(result.scope).toEqual(scope);
    expect(Object.keys(result.sourceSignatures![source.id])).toHaveLength(10);
    expect(result.sourceOutlines?.[0].scope).toBe("partial");
    expect(sourceReviewOutline(source.id, messages, [result]).chapters).toEqual([]);
  });
  it("batches long selected ranges without analyzing excluded topics", async () => {
    const expanded = messages.map((item, index) => index === 1 ? { ...item, content: item.content + "Preserved source conditions. ".repeat(2500) } : item);
    const db = await getDatabase(); for (const message of expanded) await db.put("messages", message);
    const candidates = buildFocusScopeCandidates(goal, source, expanded);
    const scope = confirmedFocusScope(candidates, new Set(candidates.filter((item) => item.recommended).map((item) => item.id)));
    const result = await generateFocusSession(goal, "answer", [source], "en", new AbortController().signal, undefined, undefined, undefined, undefined, { scope });
    expect(result.coverage?.method).toBe("full_batched");
    const payloads = synthesize.mock.calls.map(([request]) => JSON.parse(request.prompt));
    expect(payloads[0].coverage.scope).toBeUndefined();
    expect(payloads.at(-1).coverage.scope).toBe("goal");
    expect(payloads.filter((data) => data.coverage.stage === "reading").flatMap((data) => data.passages).map((item: { text: string }) => item.text).join("\n")).not.toMatch(/NumPy|broadcasting|chart/);
  });
  it("includes all topics only for explicit all-content selection", async () => {
    const result = await generateFocusSession(goal, "answer", [source], "en", new AbortController().signal, undefined, undefined, undefined, undefined, { scope: { kind: "all" } });
    const payloads = synthesize.mock.calls.map(([request]) => JSON.parse(request.prompt));
    expect(payloads.filter((data) => !data.coverage.final).flatMap((data) => data.passages)).toHaveLength(10);
    expect(payloads.at(-1).coverage.scope).toBe("all");
    expect(result.scope?.kind).toBe("all");
    expect(result.sourceOutlines?.[0].scope).toBeUndefined();
  });
  it("rejects cleared scopes, changed text and missing references instead of broadening the request", async () => {
    const { passages } = await loadFullReadingPassages([source], new AbortController().signal);
    expect(() => scopedFocusPassages(passages, { kind: "goal", blocks: [] })).toThrow();
    expect(() => scopedFocusPassages(passages.slice(1), scopeFor())).toThrow(/Source text changed/);
    expect(() => scopedFocusPassages(passages.map((item, index) => index ? item : { ...item, text: "Changed" }), scopeFor())).toThrow(/Source text changed/);
    const db = await getDatabase(); await db.put("messages", { ...messages[0], content: "Changed" });
    await expect(generateFocusSession(goal, "answer", [source], "en", new AbortController().signal, undefined, undefined, undefined, undefined, { scope: scopeFor() })).rejects.toThrow(/Source text changed/);
    expect(synthesize).not.toHaveBeenCalled();
  });
  it("cannot leak excluded topics into a section follow-up", async () => {
    const revision = { instruction: "Explain", title: "Stability", sectionId: "one", sections: [{ id: "one", title: "Stability", body: "My edits", transition: "", kind: "review" as const, evidenceIds: ["old"] }], evidence: [{ id: "old", conversationId: source.id, messageId: "scope-0", title: source.title, excerpt: "Stability" }] };
    const result = await generateFocusSession(goal, "answer", [source], "en", new AbortController().signal, revision, undefined, undefined, undefined, { scope: scopeFor() });
    expect(synthesize).toHaveBeenCalledOnce();
    expect(synthesize.mock.calls[0][0].prompt).not.toMatch(/NumPy|broadcasting|chart/);
    expect(result.scope?.kind).toBe("goal");
    expect(result.sections[0].id).toBe("one");
  });
});
