import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSidecarData, getSidecarData } from "./sidecar";
import { getDatabase } from "./db";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationGraph } from "../shared/types";

const saved: FocusSession = { id: "accepted", status: "ready", canvasId: "project", goal: "回顾方案", title: "技术路线", mode: "work", sourceConversationIds: ["current", "other"], evidence: [],
  brief: { summary: "保持简单。", turningPoints: [{ text: "改为网页版本", evidenceIds: [] }], confirmed: [{ text: "先做原型", evidenceIds: [] }], openQuestions: ["如何验证？"] },
  sections: [{ id: "custom", title: "我的理解", body: "自己补充的思路。\n\n完整正文仍在阅读页。", transition: "然后检验方案", evidenceIds: [], kind: "review", origin: "user" }, { id: "generated", title: "实现", body: "实现方案。", transition: "", evidenceIds: [], kind: "review" }],
  activeSectionId: "generated", completedSectionIds: ["custom"], notes: "私有笔记不进入侧边栏", createdAt: 1, updatedAt: 2 };
const project = { id: "project", name: "我的项目", type: "topic" as const, createdAt: 1, updatedAt: 1 };
beforeEach(async () => { const db = await getDatabase(); for (const store of ["focusSessions", "canvases", "conversations", "conversationGraphs", "messages"] as const) await db.clear(store); });

describe("saved Sidecar reading projection", () => {
  it("uses accepted versions and only confirmed related sources, preserving custom order and progress", () => {
    const preview = { ...saved, id: "preview", status: "preview" as const, rootSessionId: saved.id, title: "未确认替代稿", createdAt: 3, updatedAt: 3 };
    const unrelated = { ...saved, id: "excluded", rootSessionId: undefined, goal: "别的目标", sourceConversationIds: ["unselected"], updatedAt: 9 };
    const readings = buildSidecarData("current", [preview, unrelated, saved], [project]).readings;
    expect(readings).toHaveLength(1); expect(readings[0]).toMatchObject({ id: "accepted", projectTitle: "我的项目", summary: "保持简单。", activeSectionId: "generated", sections: [{ id: "custom", personal: true, completed: true }, { id: "generated" }] });
    expect(JSON.stringify(readings)).not.toContain("私有笔记"); expect(JSON.stringify(readings)).not.toContain("完整正文");
  });
  it("shows distinct goals separately and previews honestly when no accepted reading exists", () => {
    const other = { ...saved, id: "other-goal", goal: "另一个目标", title: "另一份回顾", status: "preview" as const, updatedAt: 4 };
    expect(buildSidecarData("current", [saved, other], [project]).readings.map(reading => [reading.id, reading.preview])).toEqual([["other-goal", true], ["accepted", false]]);
  });
  it("does not resurrect an older project scope when its accepted revision removed this source", () => {
    const newScope = { ...saved, id: "changed", rootSessionId: saved.id, sourceConversationIds: ["other"], createdAt: 4, updatedAt: 4 };
    expect(buildSidecarData("current", [saved, newScope], [project]).readings).toEqual([]);
  });
  it("falls back to saved manual source chapters and inserted understanding cards without inventing a summary", () => {
    const graph: ConversationGraph = { conversationId: "current", updatedAt: 1, edges: [], nodes: [{ id: "personal", conversationId: "current", kind: "insight", title: "个人补充", description: "记录思路。", x: 0, y: 0 }], chapters: [{ id: "chapter", conversationId: "current", title: "历史章节", summary: "当时的推理。", source: "user", collapsed: true, questionIds: [], order: 1, createdAt: 1, updatedAt: 1 }], understandingRoute: [{ id: "personal", kind: "card" }, { id: "chapter", kind: "chapter" }] };
    const data = buildSidecarData("current", [], [], undefined, graph);
    expect(data.readings[0].sessionId).toBeUndefined();
    expect(data.readings[0]).toMatchObject({ summary: "", sections: [{ id: "personal", personal: true }, { id: "chapter", lead: "当时的推理。" }] });
    expect(buildSidecarData("current", [], []).readings).toEqual([]);
  });
  it("reads saved results without creating projects, previews, or reader sessions", async () => {
    const db = await getDatabase(); await db.put("focusSessions", saved); await db.put("canvases", project);
    const data = await getSidecarData("current"); expect(data.readings[0].sessionId).toBe(saved.id); expect(await db.count("focusSessions")).toBe(1); expect(await db.count("canvases")).toBe(1);
    expect((await getSidecarData("unselected")).readings).toEqual([]); expect(await db.count("focusSessions")).toBe(1);
  });
});
