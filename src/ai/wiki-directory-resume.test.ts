import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import type { StructuredAIRequest } from "./provider";
import type { AISettings, Conversation } from "../shared/types";

it.each(["coverage", "subtopic_boundary", "topic_key"])("retries %s failures through real local caching without reissuing completed reading requests", async failure => {
  const runId = crypto.randomUUID(), sources: Conversation[] = Array.from({ length: 4 }, (_, index) => ({
    id: `${runId}:${index}`, title: "检索讨论", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1,
  }));
  const passages = sources.flatMap(source => transcriptPassages(source, [{ id: source.id, conversationId: source.id, role: "user", messageIndex: 0,
    content: "检索按消息保存索引，失败时保留原文。", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 }]));
  let allowValidPlan = false, reads = 0, writes = 0, plans = 0;
  const settings: AISettings = { id: "ai-settings", provider: "openai", model: "fixture", baseUrl: "https://fixture.invalid", apiKey: "fixture", updatedAt: 1 };
  const fetch = vi.spyOn(globalThis, "fetch");
  const ai = createAtlasAIFromProvider({ id: `wiki-resume-fixture:${failure}`, modelId: "fixture", testConnection: async () => ({ ok: true, model:"fixture" }),
    generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
      const data = JSON.parse(request.prompt);
      if (data.presentation === "wiki_topic_plan") {
        plans++;
        const ids = data.sections.map((section: { id: string }) => section.id);
        if(allowValidPlan)return request.validate({scope:[], pages:[{title:"消息检索",subtopics:[{title:"具体机制",question:"哪些条件？",sectionIds:ids}]}]});
        return request.validate({scope:[],  pages: [{ title: "消息检索", question: "如何检索？", group: "", subtopics: [{ key: failure === "topic_key" ? undefined : "t0", title: !allowValidPlan && failure === "subtopic_boundary" ? "" : "具体机制", question: "哪些条件？" }] }], assignments: Object.fromEntries((allowValidPlan || failure === "subtopic_boundary" ? ids : ids.slice(0, 1)).map((id: string) => [id, "t0"])) });
      }
      if (!data.coverage.final) {
        reads++;
        return request.validate({ title: "初读", sections: [{ title: "消息检索", body: "按消息维护检索索引。", kind: "finding", transition: "", evidenceIds: data.passages.map((passage: { id: string }) => passage.id) }] });
      }
      writes++;
      return request.validate({ title: "项目", sections: data.wikiTopics.map((topic: { ownerId: string; title: string }) => ({
        title: topic.title, wikiOwnerId: topic.ownerId, body: "## 具体机制\n\n检索按消息维护索引，失败保留原文。", kind: "finding", transition: "", evidenceIds: data.passages.map((passage: { id: string }) => passage.id),
      })) });
    },
  }, settings);
  const run = () => synthesizeCoveredFocus({ goal: "整理检索", mode: "work", locale: "zh-CN", sources, passages, ai, collectProjectKnowledge: true, signal: new AbortController().signal, validate: validateFocusResult });
  try {
    await expect(run()).rejects.toMatchObject({ code: `PROVIDER_SCHEMA_wiki_directory_${failure}` });
    // A coverage reply repeated word for word gets one split attempt (two more requests) before failing.
    expect(reads).toBeGreaterThan(0); expect(writes).toBe(0); expect(plans).toBe(failure === "coverage" ? 4 : 2);
    const completedReads = reads; allowValidPlan = true;
    const result = await run();
    expect(reads).toBe(completedReads); expect(writes).toBeGreaterThan(0);
    expect(result.topicPlanApplied).toBe(true); expect(result.result.sections).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
