import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAIProvider } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import { getDatabase } from "../storage/db";
import { recordTokenSample, resetTokenCalibration } from "./token-calibration";
import type { AISettings, Conversation } from "../shared/types";

beforeEach(() => resetTokenCalibration());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Six long single-message conversations that the planner files under one chapter. */
async function organize(model: string) {
  const sources: Conversation[] = Array.from({ length: 6 }, (_, index) => ({ id: `${model}:${index}`, title: `检索设计 ${index}`, platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 }));
  const passages = sources.flatMap((source, index) => transcriptPassages(source, [{ id: `${source.id}-m`, conversationId: source.id, messageIndex: 0, role: "user", content: `第${index}段：${"检索按消息维护索引，失败时保留原始消息并在恢复后重建。".repeat(110)}`, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 }]));
  let writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const parsed = JSON.parse((JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[1].content);
    let value: unknown;
    if (parsed.presentation === "wiki_topic_plan") {
      value = {scope:[],  pages: [{ title: "消息检索", group: "功能", question: "检索如何工作？", subtopics: [{ key: "t0", title: "具体机制", question: "哪些机制？" }] }], assignments: Object.fromEntries((parsed.sections as Array<{ id: string }>).map(section => [section.id, "t0"])) };
    } else if (!parsed.data.coverage?.final) {
      value = { notes: [{ title: "消息检索", text: parsed.data.passages[0].text, start: 0, phase: "讨论", transition: "" }] };
    } else {
      writes++;
      const data = parsed.data as { passages: Array<{ id: string; wikiOwnerId: string }>; wikiTopics: Array<{ ownerId: string; title: string; opening?: boolean }> };
      value = { title: "项目知识", sections: data.wikiTopics.map(topic => ({ title: topic.title, ...(topic.opening ? { chapterOverview: "本章说明检索的条件和恢复边界。" } : {}), body: "## 具体机制\n\n检索按消息维护索引，失败时保留原始消息。", transition: "", kind: "review", evidenceIds: data.passages.filter(passage => passage.wikiOwnerId === topic.ownerId).map(passage => passage.id) })) };
    }
    return new Response(JSON.stringify({ id: crypto.randomUUID(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] }), { headers: { "Content-Type": "application/json" } });
  }));
  const settings: AISettings = { id: "ai-settings", provider: "openai-compatible", model, baseUrl: `https://${model}.invalid/v1`, apiKey: "fixture", updatedAt: 1 };
  const result = await synthesizeCoveredFocus({ goal: "整理检索", mode: "work", locale: "zh-CN", sources, passages, modelId: model, ai: createAtlasAIFromProvider(createAIProvider(settings), settings, undefined, crypto.randomUUID()), signal: new AbortController().signal, validate: validateFocusResult });
  const checkpoint = (await (await getDatabase()).getAll("semanticDecisionCache")).find(entry => entry.id.includes(":composition-editorial-v16:") && JSON.stringify(entry.result).includes(model));
  return { result, writes, checkpoint: checkpoint?.result as { writingScale?: number } | undefined };
}

it("sizes writing batches by the provider's real token counts and freezes the scale with the checkpoint", async () => {
  const plain = await organize("calibration-off");
  expect(plain.writes).toBeGreaterThan(1);
  expect(plain.checkpoint?.writingScale).toBeUndefined();

  // The provider has been reporting about half of the local estimate for this model.
  for (let index = 0; index < 3; index++) recordTokenSample("calibration-on", 10_000, 5_000);
  const calibrated = await organize("calibration-on");
  expect(calibrated.writes).toBeLessThan(plain.writes);
  expect(calibrated.checkpoint?.writingScale).toBe(0.55);
  expect(calibrated.result.result.sections.map(section => section.title)).toEqual(["消息检索"]);
});
