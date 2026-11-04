import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AISettings } from "../shared/types";
import { createAIProvider } from "./provider";
import { requestMessages } from "./request-policy";
import { MIN_CACHEABLE_PREFIX_CHARACTERS, cacheablePrefix, resetPromptCacheTracking, splitCacheablePrefix } from "./prompt-cache";
import { WIKI_COMPOSITION_INSTRUCTIONS } from "./wiki-composition-instructions";
import { topicPlanInstructions } from "./wiki-topic-plan";

const settings = (provider: AISettings["provider"], baseUrl: string, model = "model-a"): AISettings => ({ id: "ai-settings", provider, baseUrl, apiKey: "test-secret", model, streaming: false, updatedAt: 1 });
const stable = `${"Stable writing rules. ".repeat(260)}`;
const batchSystem = (owner: string) => `${stable}\nGLOBAL WIKI TOPIC OWNERSHIP writing v2: ${JSON.stringify([{ ownerId: owner }])}`;
const request = (system: string) => ({ system, prompt: JSON.stringify({ value: 1 }), validate: (value: unknown) => value });
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

beforeEach(() => resetPromptCacheTracking());
afterEach(() => vi.unstubAllGlobals());

describe("provider prompt cache prefix", () => {
  it("cuts before per-batch instructions without changing the text", () => {
    const system = `${stable} TARGETED COMPLETION: only these topics.`;
    const { prefix, suffix } = splitCacheablePrefix(system);
    expect(prefix).toBe(stable);
    expect(prefix + suffix).toBe(system);
    expect(splitCacheablePrefix("short").prefix).toBe("short");
    expect(cacheablePrefix("short")).toBeUndefined();
  });

  it("keeps real Wiki writing batches on one identical cacheable prefix", () => {
    const wire = (owner: string) => requestMessages({ taskType: "focus_session", system: WIKI_COMPOSITION_INSTRUCTIONS + topicPlanInstructions([{ ownerId: owner, title: owner, question: owner, group: "", sectionIds: [owner] }]),
      prompt: JSON.stringify({ intent: "Organize", mode: "work", strategy: "work", locale: "en", coverage: { stage: "synthesis", final: true }, passages: [{ id: `p-${owner}`, text: "Source", wikiOwnerId: owner }], wikiTopics: [{ ownerId: owner, title: owner, question: owner }] }) })[0].content;
    const first = cacheablePrefix(wire("chapter-a")), second = cacheablePrefix(wire("chapter-b"));
    expect(first).toBeDefined();
    expect(first!.length).toBeGreaterThanOrEqual(MIN_CACHEABLE_PREFIX_CHARACTERS);
    expect(second).toBe(first);
  });
});

describe("Anthropic prompt caching", () => {
  const response = () => new Response(JSON.stringify({ id: "msg", model: "claude", content: [{ type: "text", text: "{\"ok\":true}" }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 1200 } }));

  it("marks a repeated first-party prefix and keeps the system text identical", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAIProvider(settings("anthropic", "https://api.anthropic.com/v1"));
    const usage: unknown[] = [];
    await provider.generateStructured({ ...request(batchSystem("a")), onUsage: value => usage.push(value) });
    await provider.generateStructured(request(batchSystem("b")));
    // First send is a plain string: a one-off request never pays for a cache write.
    expect(typeof bodyOf(fetchMock, 0).system).toBe("string");
    const blocks = bodyOf(fetchMock, 1).system as Array<{ text: string; cache_control?: unknown }>;
    expect(blocks[0]).toMatchObject({ type: "text", text: stable, cache_control: { type: "ephemeral" } });
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks.map(block => block.text).join("")).toBe(requestMessages(request(batchSystem("b")))[0].content);
    expect(usage[0]).toMatchObject({ inputTokens: 1300, cachedInputTokens: 1200 });
  });

  it("never sends cache blocks to compatible gateways or for short prompts", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    const gateway = createAIProvider(settings("anthropic", "https://gateway.example/anthropic/v1"));
    await gateway.generateStructured(request(batchSystem("a")));
    await gateway.generateStructured(request(batchSystem("a")));
    const official = createAIProvider(settings("anthropic", "https://api.anthropic.com/v1"));
    await official.generateStructured(request("Short."));
    await official.generateStructured(request("Short."));
    for (const call of [0, 1, 2, 3]) expect(typeof bodyOf(fetchMock, call).system).toBe("string");
  });
});

describe("OpenAI-compatible prompt caching", () => {
  const response = (usage: object) => new Response(JSON.stringify({ id: "r", model: "m", choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }], usage: { prompt_tokens: 2000, completion_tokens: 5, ...usage } }));

  it("adds a routing key only on the first-party OpenAI API", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => response({ prompt_tokens_details: { cached_tokens: 1536 } }));
    vi.stubGlobal("fetch", fetchMock);
    const usage: unknown[] = [];
    await createAIProvider(settings("openai", "https://api.openai.com/v1")).generateStructured({ ...request(batchSystem("a")), onUsage: value => usage.push(value) });
    await createAIProvider(settings("openai", "https://api.openai.com/v1")).generateStructured(request(batchSystem("b")));
    await createAIProvider(settings("openai-compatible", "https://gateway.example/v1")).generateStructured(request(batchSystem("a")));
    expect(bodyOf(fetchMock, 0).prompt_cache_key).toMatch(/^atlas-/u);
    expect(bodyOf(fetchMock, 1).prompt_cache_key).toBe(bodyOf(fetchMock, 0).prompt_cache_key);
    expect(bodyOf(fetchMock, 2)).not.toHaveProperty("prompt_cache_key");
    expect(usage[0]).toMatchObject({ inputTokens: 2000, cachedInputTokens: 1536 });
  });

  it("records DeepSeek and Moonshot automatic cache reads", async () => {
    const usage: Array<{ cachedInputTokens?: number }> = [];
    for (const [baseUrl, fields] of [["https://api.deepseek.com", { prompt_cache_hit_tokens: 1024 }], ["https://api.moonshot.cn/v1", { cached_tokens: 768 }], ["https://gateway.example/v1", {}]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response(fields)));
      await createAIProvider(settings("openai-compatible", baseUrl)).generateStructured({ ...request("Rules."), onUsage: value => usage.push(value) });
    }
    expect(usage.map(item => item.cachedInputTokens)).toEqual([1024, 768, undefined]);
  });
});

describe("Gemini implicit caching", () => {
  it("records reused prefix tokens without changing the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ responseId: "g", candidates: [{ content: { parts: [{ text: "{\"ok\":true}" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 5, cachedContentTokenCount: 2048 } })));
    vi.stubGlobal("fetch", fetchMock);
    const usage: unknown[] = [];
    await createAIProvider(settings("gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-test")).generateStructured({ ...request(batchSystem("a")), onUsage: value => usage.push(value) });
    expect(usage[0]).toMatchObject({ inputTokens: 3000, cachedInputTokens: 2048 });
    expect(bodyOf(fetchMock, 0).systemInstruction.parts[0].text).toBe(requestMessages(request(batchSystem("a")))[0].content);
  });
});
