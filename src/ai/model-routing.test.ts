import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdaptiveConcurrency, isReadingRequest, providerConcurrencyCeiling, usesMainModelForPlanning } from "./model-routing";
import { createAtlasAI } from "./atlas-ai";
import { getDatabase } from "../storage/db";
import type { AISettings } from "../shared/types";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("routing rules", () => {
  it("keeps Wiki planning on the main model and recognizes reading batches", () => {
    expect(usesMainModelForPlanning("other", { presentation: "wiki_topic_plan" })).toBe(true);
    expect(usesMainModelForPlanning("other", { presentation: "home_task_review" })).toBe(false);
    expect(isReadingRequest("focus_session", { coverage: { stage: "reading", final: false } })).toBe(true);
    expect(isReadingRequest("focus_session", { coverage: { stage: "synthesis", final: true } })).toBe(false);
  });

  it("allows more parallel requests on large hosted APIs than on unknown gateways", () => {
    expect(providerConcurrencyCeiling("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(10);
    expect(providerConcurrencyCeiling("https://api.deepseek.com")).toBe(10);
    expect(providerConcurrencyCeiling("https://my-gateway.example/v1")).toBe(3);
    expect(providerConcurrencyCeiling("not a url")).toBe(3);
  });

  it("grows one slot after a run of successes, halves on a rate limit and holds one slot for a minute", () => {
    const control = new AdaptiveConcurrency(6, 2);
    expect(control.current(0)).toBe(3);
    for (let index = 0; index < 20; index++) control.success();
    expect(control.current(0)).toBe(6);
    control.rateLimited(1_000);
    expect(control.current(1_000)).toBe(1);
    expect(control.current(62_000)).toBe(3);
    expect(new AdaptiveConcurrency(2).current(0)).toBe(2);
    // A host that takes ten starts at six.
    expect(new AdaptiveConcurrency(10).current(0)).toBe(6);
  });
});

describe("AtlasAI model routing", () => {
  const settings = (suffix: string): AISettings => ({ id: "ai-settings", provider: "openai-compatible", baseUrl: `https://routing-${suffix}.invalid/v1`, apiKey: "fixture", model: "main-model", economyModel: "economy-model", streaming: false, updatedAt: 1 });
  const reading = (text: string) => ({ taskType: "focus_session" as const, system: "Read source notes", prompt: JSON.stringify({ intent: "整理", mode: "work", locale: "zh-CN", coverage: { stage: "reading", final: false }, passages: [{ id: "p1", text }] }), validate: (value: unknown) => value });
  const stub = () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
      models.push(body.model);
      const data = JSON.parse(body.messages[1].content);
      const value = data.data?.coverage?.stage === "reading" ? { notes: [{ title: "检索", text: "检索按消息维护索引。", start: 0, phase: "讨论", transition: "" }] } : {scope:[],  pages: [] };
      return new Response(JSON.stringify({ id: crypto.randomUUID(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }), { headers: { "Content-Type": "application/json" } });
    }));
    return models;
  };

  it("reads with the economy model and plans with the main model", async () => {
    const models = stub(), ai = createAtlasAI(settings("split"));
    await ai.synthesize(reading("检索按消息维护索引。"));
    await ai.decide({ taskType: "other", system: "Plan the directory", prompt: JSON.stringify({ presentation: "wiki_topic_plan", sections: [] }), validate: value => value });
    await ai.decide({ taskType: "other", system: "Review", prompt: JSON.stringify({ presentation: "home_task_review" }), validate: value => value });
    expect(models).toEqual(["economy-model", "main-model", "economy-model"]);
  });

  it("reuses a batch the main model already read instead of paying the economy model again", async () => {
    const models = stub(), request = reading("通知只有在用户开启后发送。");
    await createAtlasAI(settings("reuse")).synthesize(request);
    expect(models).toEqual(["economy-model"]);
    // Rewrite that result as if an earlier version had read it with the main model.
    const db = await getDatabase(), row = (await db.getAll("semanticDecisionCache")).find(entry => entry.id.includes("economy-model") && JSON.stringify(entry.result).includes("检索"))!;
    await db.delete("semanticDecisionCache", row.id);
    const ai = createAtlasAI(settings("reuse")) as unknown as { cacheIdentity: (role: string, request: unknown, model: string, version: string) => Promise<{ id: string; hash: string }>; synthesize: (request: unknown) => Promise<unknown>; hasCachedSynthesis: (request: unknown) => Promise<boolean> };
    const main = await ai.cacheIdentity("synthesis", request, "main-model", "");
    await db.put("semanticDecisionCache", { ...row, id: main.id, inputHash: main.hash, modelId: "main-model" });
    expect(await ai.hasCachedSynthesis(request)).toBe(true);
    await ai.synthesize(request);
    expect(models).toEqual(["economy-model"]);
  });
});
