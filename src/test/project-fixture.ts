import type { FocusSession } from "../shared/focus-session";
import { validateProjectState } from "../shared/project-state";

export const projectText = "需求采集提取目标与约束，将目标与约束交给方案生成。方案生成输出候选计划。规则校验检查约束，失败时回到方案生成修正。先验证核心流程，再扩展功能。下一步完成规则校验测试。";
export const projectFixture: FocusSession = {
  id: "project-fixture", mode: "work", goal: "继续完善任务规划工具", title: "任务规划工具", locale: "zh-CN", sourceConversationIds: ["source"],
  evidence: [{ id: "e1", conversationId: "source", messageId: "message", title: "规划讨论", excerpt: projectText }],
  sections: [{ id: "one", title: "核心流程", body: projectText, evidenceIds: ["e1"], transition: "", kind: "finding" }],
  activeSectionId: "one", completedSectionIds: [], notes: "我的笔记", createdAt: 1, updatedAt: 1,
};
export const projectWire = {
  summary: "围绕目标与约束生成计划，再通过规则校验修正。",
  modules: [
    { id: "module:input", title: "需求采集", layer: "输入层", purpose: "提取目标与约束", inputs: ["用户需求"], outputs: ["目标与约束"], status: "documented", quote: "需求采集提取目标与约束", evidenceIds: ["e1"] },
    { id: "module:plan", title: "方案生成", layer: "处理层", purpose: "输出候选计划", inputs: ["目标与约束"], outputs: ["候选计划"], status: "proposal", quote: "方案生成输出候选计划", evidenceIds: ["e1"] },
  ],
  relations: [{ from: "module:input", to: "module:plan", label: "目标与约束", kind: "flow", quote: "将目标与约束交给方案生成", evidenceIds: ["e1"] }],
  decisions: [{ id: "decision:scope", text: "先验证核心流程", reason: "降低验证成本", status: "documented", quote: "先验证核心流程，再扩展功能", evidenceIds: ["e1"] }],
  constraints: [{ id: "constraint:rules", text: "计划必须符合约束", reason: "", status: "documented", quote: "规则校验检查约束", evidenceIds: ["e1"] }],
  actions: [{ id: "action:test", text: "完成规则校验测试", reason: "", status: "proposal", quote: "下一步完成规则校验测试", evidenceIds: ["e1"] }],
};
export function projectSession(): FocusSession { return { ...structuredClone(projectFixture), projectState: validateProjectState(structuredClone(projectWire), [{ id: "e1", text: projectText }], projectFixture) }; }
