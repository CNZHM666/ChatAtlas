import { CURRENT_FOCUS_TASK_VERSION } from "./demo-api";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISettings } from "../shared/types";
import { createAtlasAI, createAtlasAIFromProvider } from "./atlas-ai";
import { listAIUsage } from "../storage/ai-usage";
import { AIProviderHttpError, AIProviderResponseError, type AtlasAIProvider, type StructuredAIRequest } from "./provider";
import { atlasApiClient, DemoApiError } from "./demo-api";
import { AIProviderValidationError } from "./provider-errors";

const settings: AISettings = { id: "ai-settings", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "test", model: "one-model", updatedAt: 1 };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("AtlasAI facade", () => {
  it("records ownership repair counts independently of the rejected source directory",async()=>{
    const failure=new AIProviderValidationError("wiki_directory_ownership_incomplete"),runId=crypto.randomUUID();failure.wikiOwnershipDetails={expectedSlots:17,receivedSlots:2,reason:"count"};failure.fieldPaths=["owners"];
    const generateStructured=vi.fn().mockRejectedValue(failure);
    const atlas=createAtlasAIFromProvider({id:"ownership-counts",testConnection:vi.fn(),generateStructured},settings,undefined,runId);
    await expect(atlas.generateStructured({taskType:"other",system:"Return JSON",prompt:JSON.stringify({presentation:"wiki_topic_plan",stage:"ownership",fixture:runId}),maxAttempts:1,validate:value=>value})).rejects.toBe(failure);
    expect(generateStructured).toHaveBeenCalledOnce();expect((await listAIUsage()).find(event=>event.runId===runId)).toMatchObject({validationPaths:["owners"],ownershipValidation:{expectedSlots:17,receivedSlots:2,reason:"count"}});
  });
  it("halves concurrency on a rate limit, holds one slot for a minute, then recovers gradually",async()=>{
    const clock=vi.spyOn(Date,"now").mockReturnValue(1_700_000_000_000);
    const atlas=createAtlasAIFromProvider({id:"cooldown",modelId:"fixture",capabilities:{textGeneration:true,structuredOutput:"json",embeddings:false,requestUsage:true,maxConcurrency:3},testConnection:vi.fn(),generateStructured:async()=>{throw new AIProviderHttpError(429,"busy");}},settings);
    expect(atlas.capabilities.maxConcurrency).toBe(3);
    await expect(atlas.generateStructured({system:"test",prompt:crypto.randomUUID(),maxAttempts:1,validate:value=>value})).rejects.toMatchObject({status:429});
    expect(atlas.capabilities.maxConcurrency).toBe(1);clock.mockReturnValue(1_700_000_060_001);expect(atlas.capabilities.maxConcurrency).toBe(1);
  });
  it("leaves history repair to its owner and records failing field paths without a second paid generation", async () => {
    const failure = new AIProviderValidationError("history_evidence_invalid"); failure.fieldPaths = ["events[0].reason"];
    const generateStructured = vi.fn().mockRejectedValue(failure), runId = crypto.randomUUID();
    const atlas = createAtlasAIFromProvider({ id: "history-single-attempt", testConnection: vi.fn(), generateStructured }, settings, undefined, runId);
    await expect(atlas.synthesize({ system: "Return JSON", prompt: JSON.stringify({ presentation: "product_history", stage: "extract", fixture: crypto.randomUUID() }), validate: value => value })).rejects.toBe(failure);
    expect(generateStructured).toHaveBeenCalledOnce();
    expect((await listAIUsage()).find(item => item.runId === runId)).toMatchObject({ validationPaths: ["events[0].reason"] });
  });
  it.each([
    { presentation: "wiki_claim_correction", requested: 6000 },
    { presentation: "semantic_structure", requested: 6000 },
    { presentation: "structure_review", requested: 2400 },
    { presentation: "wiki_claim_verification", requested: 1800 },
    { stage: "project:verify", requested: 1200 },
  ])("sends the actual correction/review output allowance to the provider: %s", async ({ requested, ...data }) => {
    const generateStructured = vi.fn(async <T>(request: StructuredAIRequest<T>): Promise<T> => request.validate({ checks: [] }));
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(), generateStructured: <T>(request: StructuredAIRequest<T>) => generateStructured(request as StructuredAIRequest<unknown>) as Promise<T> }, settings);
    await atlas.synthesize({ taskType: "other", system: "Return strict JSON.", prompt: JSON.stringify({ ...data, fixture: crypto.randomUUID() }), maxOutputTokens: requested, validate: value => value });
    expect(generateStructured.mock.calls[0][0].maxOutputTokens).toBe(requested);
  });
  it("keys caches by generation parameters and discards rejected final synthesis without clearing reading batches", async () => {
    let generation = 0;
    const generateStructured = vi.fn(async <T>(request: StructuredAIRequest<T>): Promise<T> => request.validate({ generation: ++generation }));
    const atlas = createAtlasAIFromProvider({ id: "parameter-cache", modelId: "fixture", testConnection: vi.fn(), generateStructured: <T>(request: StructuredAIRequest<T>) => generateStructured(request as StructuredAIRequest<unknown>) as Promise<T> }, settings);
    const request = { system: "Read", prompt: crypto.randomUUID(), validate: (value: unknown) => value };
    await atlas.synthesize({ ...request, temperature: 0, maxOutputTokens: 100 });
    await atlas.synthesize({ ...request, temperature: .5, maxOutputTokens: 100 });
    await atlas.synthesize({ ...request, temperature: .5, maxOutputTokens: 200 });
    await atlas.synthesize({ ...request, temperature: .5, maxOutputTokens: 200 });
    expect(generateStructured).toHaveBeenCalledTimes(3);
    const reading = { ...request, taskType: "focus_session" as const, prompt: JSON.stringify({ intent: crypto.randomUUID(), mode: "work", locale: "en", coverage: { stage: "reading", final: false }, passages: [{ id: "raw", text: "Original" }] }) };
    const final = { ...reading, prompt: reading.prompt.replace('"final":false', '"final":true') };
    await atlas.synthesize(reading); await atlas.synthesize(final);
    await atlas.discardFinalSynthesis?.();
    expect(await atlas.hasCachedSynthesis?.(reading)).toBe(true);
    expect(await atlas.hasCachedSynthesis?.(final)).toBe(false);
  });
  it("refreshes local cache only after success and leaves the previous result usable after a failed refresh", async () => {
    let revision = 0;
    const generateStructured = vi.fn(async <T>(request: StructuredAIRequest<T>) => request.validate({ revision: ++revision }));
    const atlas = createAtlasAIFromProvider({ id: "refresh-test", modelId: "one-model", testConnection: vi.fn(), generateStructured: <T>(request: StructuredAIRequest<T>) => generateStructured(request as StructuredAIRequest<unknown>) as Promise<T> }, settings);
    const hit = vi.fn();
    const request = { system: "Plan", prompt: crypto.randomUUID(), validate: (value: unknown) => value as { revision: number }, onCacheHit: hit };
    expect(await atlas.synthesize(request)).toEqual({ revision: 1 });
    expect(await atlas.synthesize(request)).toEqual({ revision: 1 }); expect(hit).toHaveBeenCalledOnce();
    expect(await atlas.hasCachedSynthesis?.({ ...request, bypassCache: true })).toBe(false);
    expect(await atlas.synthesize({ ...request, bypassCache: true })).toEqual({ revision: 2 });
    expect(generateStructured).toHaveBeenCalledTimes(2); expect(hit).toHaveBeenCalledOnce();
    generateStructured.mockRejectedValueOnce(new AIProviderResponseError("PROVIDER_TIMEOUT", "refresh-failure"));
    await expect(atlas.synthesize({ ...request, bypassCache: true })).rejects.toThrow();
    expect(await atlas.synthesize(request)).toEqual({ revision: 2 });
    expect(generateStructured).toHaveBeenCalledTimes(3);
  });
  it.each(["parent", "request"] as const)("honors %s cancellation when the task has two signals", async target => {
    const parent = new AbortController(), child = new AbortController();
    const generateStructured = vi.fn(<T>(request: StructuredAIRequest<T>) => new Promise<T>((_resolve, reject) => request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true })));
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(), generateStructured: <T>(request: StructuredAIRequest<T>) => generateStructured(request as StructuredAIRequest<unknown>) as Promise<T> }, settings, parent.signal);
    const pending = atlas.synthesize({ system: "cancel", prompt: crypto.randomUUID(), signal: child.signal, validate: value => value });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(generateStructured).toHaveBeenCalledOnce());
    (target === "parent" ? parent : child).abort(); await rejected;
    expect(generateStructured).toHaveBeenCalledOnce();
  });
  it.each([new AIProviderValidationError("unknown_evidence_id"), new Error("A section revision must return exactly one section.")])("does not rebill the complete focus input after validation: %s", async (failure) => {
    const generateStructured = vi.fn().mockRejectedValue(failure);
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(), generateStructured }, settings);
    await expect(atlas.synthesize({ taskType: "focus_session", system: "", prompt: JSON.stringify({ intent: crypto.randomUUID(), mode: "review", locale: "en", passages: [{ id: "raw", text: "Original" }] }), validate: (value) => value })).rejects.toBe(failure);
    expect(generateStructured).toHaveBeenCalledOnce();
  });
  it("preflights only uncached focus reading and a final reserve, and keeps fully cached reading usable", async () => {
    vi.spyOn(atlasApiClient, "getSession").mockResolvedValue({ token: "test", expiresAt: new Date(Date.now() + 60000).toISOString(), taskVersion: String(CURRENT_FOCUS_TASK_VERSION), models: { main: "qwen-plus", economy: "qwen-plus" }, embedding: { modelKey: "test", dimensions: 2 } });
    const preflight = vi.spyOn(atlasApiClient, "preflightFocus").mockResolvedValue();
    const atlas = createAtlasAIFromProvider({ id: "atlas-demo", modelId: "atlas-demo", testConnection: async () => ({ ok: true, model: "atlas-demo" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => request.validate({ ok: true }) }, settings);
    const request = { taskType: "focus_session" as const, system: "Read", prompt: JSON.stringify({ intent: crypto.randomUUID(), mode: "review", locale: "en", coverage: { stage: "reading", final: false }, passages: [{ id: "e1", text: "Original" }] }), validate: (value: unknown) => value };
    await atlas.prepareFocus?.([request], { goal: "复习", mode: "review" });
    expect(preflight).toHaveBeenCalledOnce();
    expect(preflight.mock.calls[0][0]).toMatchObject([{ strategy: "review", intermediate: true }, { strategy: "review", intermediate: false, inputTokens: 14000 }]);
    await atlas.synthesize(request);
    preflight.mockClear();
    await atlas.prepareFocus?.([request], { goal: "复习其他目标", mode: "review" });
    expect(preflight).not.toHaveBeenCalled();
    const changed = { ...request, prompt: request.prompt.replace("Original", "Corrected") };
    await atlas.prepareFocus?.([request, changed], { goal: "复习", mode: "review" });
    expect(preflight.mock.calls[0][0]).toHaveLength(2);
  });
  it("routes extraction to the selected economy model and synthesis to the main model", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      models.push((JSON.parse(String(init.body)) as { model: string }).model);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
    }));
    const atlas = createAtlasAI({ ...settings, economyModel: "small-model" });
    const unique = crypto.randomUUID();
    await atlas.extract({ system: "Extract", prompt: unique, validate: (value) => value });
    await atlas.synthesize({ system: "Plan", prompt: unique, validate: (value) => value });
    expect(models).toEqual(["small-model", "one-model"]);
    expect(atlas.getUsageSnapshot?.()).toMatchObject({ requests: 2, inputTokens: 6, outputTokens: 4 });
  });
  it("checks reusable synthesis without a model request and separates changed input and role", async () => {
    const generateStructured = vi.fn();
    const atlas = createAtlasAIFromProvider({ id: "cache-probe", modelId: "one-model", testConnection: vi.fn(), generateStructured: async <T>(request: StructuredAIRequest<T>) => { generateStructured(); return request.validate({ preserved: true }); } }, settings);
    const request = { system: "Neutral notes", prompt: JSON.stringify({ locale: "en", value: crypto.randomUUID() }), validate: (value: unknown) => value };
    expect(await atlas.hasCachedSynthesis?.(request)).toBe(false);
    await atlas.synthesize(request);
    expect(await atlas.hasCachedSynthesis?.(request)).toBe(true);
    expect(await atlas.hasCachedSynthesis?.({ ...request, prompt: request.prompt + " " })).toBe(false);
    expect(generateStructured).toHaveBeenCalledOnce();
    const extraction = { ...request, prompt: JSON.stringify({ locale: "en", value: crypto.randomUUID() }) };
    await atlas.extract(extraction);
    expect(await atlas.hasCachedSynthesis?.(extraction)).toBe(false);
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });
  it("does not issue or retry requests after organization is cancelled", async () => {
    const controller = new AbortController();
    const generateStructured = vi.fn();
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(async () => ({ ok: true as const, model: "one-model" })), generateStructured }, settings, controller.signal);
    controller.abort();
    await expect(atlas.synthesize({ system: "Plan", prompt: "cancelled", validate: (value) => value })).rejects.toMatchObject({ name: "AbortError" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("passes cancellation to an in-flight provider request", async () => {
    const controller = new AbortController();
    let calls = 0;
    const generateStructured = async <T>(request: StructuredAIRequest<T>): Promise<T> => { calls += 1; return new Promise<T>((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
    }); };
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(async () => ({ ok: true as const, model: "one-model" })), generateStructured }, settings, controller.signal);
    const pending = atlas.extract({ system: "Extract", prompt: "in flight", validate: (value) => value });
    await vi.waitFor(() => expect(calls).toBe(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
  it("uses one provider and model for roles, retries invalid structured output once, then caches the decision", async () => {
    const generateStructured = vi.fn().mockRejectedValueOnce(new Error("schema failure")).mockImplementation(async (request) => request.validate({ answer: "valid" }));
    const provider: AtlasAIProvider = { id: "deepseek", modelId: "one-model", capabilities: { textGeneration: true, structuredOutput: "json", embeddings: false }, testConnection: vi.fn(async () => ({ ok: true as const, model: "one-model" })), generateStructured };
    const atlas = createAtlasAIFromProvider(provider, settings);
    const request = { system: "Decide", prompt: "same input", validate: (value: unknown) => { if (!value || typeof value !== "object" || (value as { answer?: unknown }).answer !== "valid") throw new Error("invalid"); return value as { answer: string }; } };
    expect(await atlas.decide(request)).toEqual({ answer: "valid" });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(await atlas.decide(request)).toEqual({ answer: "valid" });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(atlas.capabilities.embeddings).toBe(false);
  });

  it("does not retry authentication failures", async () => {
    const generateStructured = vi.fn().mockRejectedValue(new AIProviderHttpError(401, "invalid API key"));
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(async () => ({ ok: true as const, model: "one-model" })), generateStructured }, settings);
    await expect(atlas.decide({ system: "Decide", prompt: "auth failure", validate: (value) => value })).rejects.toThrow("401");
    expect(generateStructured).toHaveBeenCalledTimes(1);
  });

  it("does not spend another request repairing model-not-found or an empty provider result", async () => {
    for (const error of [new AIProviderHttpError(404, JSON.stringify({ error: { code: "model_not_found" }, request_id: "missing-model-id" })), new AIProviderResponseError("PROVIDER_EMPTY_RESPONSE"), new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE"), new AIProviderResponseError("PROVIDER_TIMEOUT")]) {
      const generateStructured = vi.fn().mockRejectedValue(error);
      const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(), generateStructured }, settings);
      await expect(atlas.decide({ system: "JSON", prompt: crypto.randomUUID(), validate: (value) => value })).rejects.toBe(error);
      expect(generateStructured).toHaveBeenCalledOnce();
      expect((await listAIUsage()).find((item) => item.errorCode === error.code)).toBeDefined();
    }
  });

  it("retries rate limits without a misleading schema-repair instruction", async () => {
    const generateStructured = vi.fn().mockRejectedValueOnce(new AIProviderHttpError(429, "rate limited", 0)).mockImplementation(async (request) => request.validate({ answer: "valid" }));
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(async () => ({ ok: true as const, model: "one-model" })), generateStructured }, settings);
    await expect(atlas.decide({ system: "Decide", prompt: "rate limited", validate: (value) => value })).resolves.toEqual({ answer: "valid" });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[1][0].system).toBe("Decide");
  });
  it("retries a temporarily busy ChatAtlas AI request without changing the prompt", async () => {
    vi.spyOn(atlasApiClient, "getSession").mockResolvedValue({ token: "test", expiresAt: new Date(Date.now() + 60_000).toISOString(), taskVersion: "1", embedding: { modelKey: "atlas-demo:test:1", dimensions: 2 } });
    const generateStructured = vi.fn().mockRejectedValueOnce(new DemoApiError("PROVIDER_BUSY", 502)).mockImplementation(async (request) => request.validate({ ok: true }));
    const atlas = createAtlasAIFromProvider({ id: "atlas-demo", modelId: "atlas-demo", testConnection: vi.fn(async () => ({ ok: true as const, model: "atlas-demo" })), generateStructured }, settings);
    await expect(atlas.synthesize({ taskType: "chapter_planning", system: "Plan", prompt: `busy-${crypto.randomUUID()}`, validate: (value) => value })).resolves.toEqual({ ok: true });
    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(generateStructured.mock.calls[1][0].system).toBe("Plan");
  });
  it("does not retry exhausted ChatAtlas AI quota", async () => {
    vi.spyOn(atlasApiClient, "getSession").mockResolvedValue({ token: "test", expiresAt: new Date(Date.now() + 60_000).toISOString(), taskVersion: "1", embedding: { modelKey: "atlas-demo:test:1", dimensions: 2 } });
    const generateStructured = vi.fn().mockRejectedValue(new DemoApiError("DEMO_QUOTA_EXHAUSTED", 429));
    const atlas = createAtlasAIFromProvider({ id: "atlas-demo", modelId: "atlas-demo", testConnection: vi.fn(async () => ({ ok: true as const, model: "atlas-demo" })), generateStructured }, settings);
    await expect(atlas.synthesize({ taskType: "chapter_planning", system: "Plan", prompt: `quota-${crypto.randomUUID()}`, validate: (value) => value })).rejects.toMatchObject({ code: "DEMO_QUOTA_EXHAUSTED" });
    expect(generateStructured).toHaveBeenCalledOnce();
  });
  it.each(["PROVIDER_OUTPUT_TRUNCATED", "PROVIDER_STREAM_INCOMPLETE", "PROVIDER_TIMEOUT", "PROVIDER_RESPONSE_REJECTED", "PROVIDER_EMPTY_RESPONSE"])("does not repeat a goal result rejected with %s", async (code) => {
    vi.spyOn(atlasApiClient, "getSession").mockResolvedValue({ token: "test", expiresAt: new Date(Date.now() + 60_000).toISOString(), taskVersion: String(CURRENT_FOCUS_TASK_VERSION), embedding: { modelKey: "atlas-demo:test:1", dimensions: 2 } });
    const generateStructured = vi.fn().mockRejectedValue(new DemoApiError(code, 502));
    const atlas = createAtlasAIFromProvider({ id: "atlas-demo", modelId: "atlas-demo", capabilities: { textGeneration: true, structuredOutput: "json", embeddings: false, requestUsage: true }, testConnection: vi.fn(async () => ({ ok: true as const, model: "atlas-demo" })), generateStructured }, settings);
    expect(atlas.capabilities.maxConcurrency).toBe(2);
    await expect(atlas.synthesize({ taskType: "focus_session", system: "Review", prompt: `truncated-${crypto.randomUUID()}`, validate: (value) => value })).rejects.toMatchObject({ code });
    expect(generateStructured).toHaveBeenCalledOnce();
  });
  it("reuses normalized structured results without re-validating them as the raw envelope or billing again", async () => {
    let calls = 0;
    const generateStructured = async <T>(request: StructuredAIRequest<T>): Promise<T> => { calls += 1; return request.validate({ items: ["one", "two"] }); };
    const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(async () => ({ ok: true as const, model: "one-model" })), generateStructured }, settings);
    const request = { taskType: "chapter_planning" as const, conversationIds: ["normalized-cache-test"], system: "Extract array", prompt: "unique normalized-cache-test", validate: (value: unknown) => {
      if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) throw new Error("raw envelope required");
      return (value as { items: string[] }).items;
    } };
    expect(await atlas.synthesize(request)).toEqual(["one", "two"]);
    expect(await atlas.synthesize(request)).toEqual(["one", "two"]);
    expect(calls).toBe(1);
    expect(atlas.getUsageSnapshot?.()).toMatchObject({ cacheHits: 1, cacheMisses: 1 });
    const ledger = (await listAIUsage()).filter((event) => event.conversationIds.includes("normalized-cache-test"));
    expect(ledger).toHaveLength(2);
    expect(ledger.find((event) => event.status === "completed")).toMatchObject({ taskType: "chapter_planning", tokenSource: "estimated" });
    expect(ledger.find((event) => event.status === "cached")).toMatchObject({ inputTokens: 0, outputTokens: 0, costCny: 0 });
  });

  it("does not cache incomplete extraction results", async () => {
    let calls = 0;
    const atlas = createAtlasAIFromProvider({ testConnection: async () => ({ ok: true, model: "one-model" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      calls += 1;
      return request.validate({ items: calls === 1 ? [] : ["complete"] });
    } }, settings);
    const request = { taskType: "question_snapshot" as const, system: "Extract", prompt: "unique incomplete extraction", validate: (value: unknown) => (value as { items: string[] }).items, cacheIf: (items: string[]) => items.length > 0 };
    expect(await atlas.extract(request)).toEqual([]);
    expect(await atlas.extract(request)).toEqual(["complete"]);
    expect(await atlas.extract(request)).toEqual(["complete"]);
    expect(calls).toBe(2);
  });

  it("tags billed requests with the organization run and measures provider time", async () => {
    const runId = crypto.randomUUID();
    const atlas = createAtlasAIFromProvider({ testConnection: async () => ({ ok: true, model: "one-model" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => request.validate({ ok: true }) }, settings, undefined, runId);
    await atlas.extract({ taskType: "question_snapshot", system: "Extract", prompt: `run-${runId}`, validate: (value) => value });
    expect((await listAIUsage()).find((event) => event.runId === runId)).toMatchObject({ taskType: "question_snapshot", durationMs: expect.any(Number), status: "completed" });
  });
});

it("shares overlapping focus requests once, retains independent results and retries fresh after failure", async () => {
  const generateStructured = vi.fn().mockImplementation(async <T>(request: StructuredAIRequest<T>) => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return request.validate({ sections: [{ body: "Preserved" }] });
  });
  const atlas = createAtlasAIFromProvider({ testConnection: vi.fn(), generateStructured }, settings);
  const request = { taskType: "focus_session" as const, system: "Fixed contract", prompt: JSON.stringify({ intent: crypto.randomUUID(), mode: "review", passages: [{ id: "e1", text: "Original" }] }), validate: (value: unknown) => value as { sections: { body: string }[] } };
  const [one, two] = await Promise.all([atlas.synthesize(request), atlas.synthesize({ ...request })]);
  expect(generateStructured).toHaveBeenCalledOnce();
  one.sections[0].body = "Changed locally";
  expect(two.sections[0].body).toBe("Preserved");
  expect(atlas.getUsageSnapshot?.()).toMatchObject({ cacheHits: 1, cacheMisses: 1 });
  generateStructured.mockRejectedValueOnce(new AIProviderValidationError("unknown_evidence_id"));
  const changed = { ...request, prompt: request.prompt.replace("Original", "Corrected") };
  await expect(atlas.synthesize(changed)).rejects.toMatchObject({ code: "PROVIDER_SCHEMA_unknown_evidence_id" });
  await expect(atlas.synthesize(changed)).resolves.toMatchObject({ sections: [{ body: "Preserved" }] });
  expect(generateStructured).toHaveBeenCalledTimes(3);
});
