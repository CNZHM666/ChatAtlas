import { expect, it } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import { overviewModel } from "./overview-model";
const session: FocusSession = { id: "s", title: "Review", goal: "Review", mode: "review", sourceConversationIds: ["c"], evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
it("retains every chronological stage, including middle corrections, without changing user reading order", () => {
  const chapters = Array.from({ length: 22 }, (_, index) => ({ id: `${index}`, title: index === 7 ? "修正关键前提" : `阶段内容 ${index}`, summary: `原始讨论 ${index}。`, messageIds: [`m${index}`] }));
  const result = overviewModel({ ...session, sourceOutlines: [{ conversationId: "c", chapters }] }, true);
  expect(result.groups).toHaveLength(22);
  expect(result.groups.flatMap(group => group.items).map(stage => stage.id)).toEqual(chapters.map(chapter => chapter.id));
  expect(result.stages[7].title).toBe("修正关键前提"); expect(result.chronological).toBe(true);
  expect(session.sections).toEqual([]);
});
it("deduplicates open questions across Brief, chapters and review notes, hiding wire markers only in presentation", () => {
  const saved = { ...session, brief: { summary: "概况[e1]。", turningPoints: [], confirmed: [], openQuestions: ["接下来如何验证？"] }, reviewNeeds: { one: " 接下来如何验证? " }, sections: [{ id: "one", title: "接下来如何验证？[e3]", body: "", evidenceIds: [], transition: "", kind: "open_question" as const }] };
  const result = overviewModel(saved, true);
  expect(result.open).toEqual(["接下来如何验证？"]); expect(result.summary).toBe("概况。");
  expect(saved.brief.summary).toContain("[e1]");
});

it("uses each original conversation outline instead of Wiki titles for cross-conversation discussion", () => {
  const a = { id: "ea", conversationId: "a", messageId: "m", title: "来源 A", excerpt: "先确定输入" }, b = { ...a, id: "eb", conversationId: "b", title: "来源 B", excerpt: "再讨论验证" };
  const cross = { ...session, sourceConversationIds: ["a", "b"], evidence: [a, b], sections: [{ id: "wiki", title: "Wiki 技术架构", body: "生成的长篇文章", kind: "review" as const, evidenceIds: ["ea", "eb"], transition: "" }], sourceOutlines: [
    { conversationId: "a", chapters: [{ id: "same", title: "原讨论输入边界", summary: "输入的原始分析", messageIds: ["m"] }] },
    { conversationId: "b", chapters: [{ id: "same", title: "原讨论验证分支", summary: "验证的原始分析", messageIds: ["m"] }] },
  ] };
  const result = overviewModel(cross, true);
  expect(result.stages.map(stage => stage.title)).toEqual(["原讨论输入边界", "原讨论验证分支"]);
  expect(new Set(result.stages.map(stage => stage.id)).size).toBe(2);
  expect(result.stages.map(stage => stage.evidence)).toEqual([a, b]);
  const legacy = overviewModel({ ...cross, sourceOutlines: undefined }, true);
  expect(legacy.stages.map(stage => stage.body)).toEqual(["先确定输入", "再讨论验证"]);
  expect(legacy.stages.some(stage => stage.title === "Wiki 技术架构")).toBe(false);
});
