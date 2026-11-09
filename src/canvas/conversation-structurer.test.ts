import { describe, expect, it } from "vitest";
import type { Conversation, ConversationMessage } from "../shared/types";
import { buildConversationStructure, cleanChapterTitle, questionDisplayTitle, questionPlainText, refineChapterGroups } from "./conversation-structurer";

const conversation: Conversation = { id: "chapters", platform: "chatgpt", title: "Product notes", url: "https://chatgpt.com/c/chapters", updatedAt: 1, messageCount: 0 };
const question = (id: number, content: string): ConversationMessage => ({ id: `q${id}`, conversationId: conversation.id, messageIndex: id, role: "user", content, preview: content, contentHash: `${id}`, createdAt: id, updatedAt: id });

describe("local conversation structure", () => {
  it("leaves one to three questions simple and gives long prompts a concise label", () => {
    expect(buildConversationStructure(conversation, [question(1, "First"), question(2, "Second")]).chapters).toEqual([]);
    expect(buildConversationStructure(conversation, [question(1, "First"), question(2, "Second"), question(3, "Third")]).chapters).toEqual([]);
    expect(questionDisplayTitle("@创建图片 一张高端极简的产品更新海报，适用于微信小程序更新弹窗，竖版构图和大面积留白。")).toBe("一张高端极简的产品更新海报");
    expect(questionDisplayTitle("这个界面是不是中间太小了，有什么优化方案吗")).toBe("界面尺寸与布局优化");
  });

  it("finds a topic shift without splitting at a fixed number of messages", () => {
    const messages = ["产品定位与目标用户", "产品定位的用户需求", "产品定位与商业模式", "导入历史对话同步", "同步 Web Session 与导入"].map((text, index) => question(index, text));
    const structure = buildConversationStructure(conversation, messages, 100);
    expect(structure.chapters.map((chapter) => chapter.questionIds.length)).toEqual([3, 2]);
    expect(structure.chapters.map((chapter) => chapter.title)).toEqual(["产品定位", "导入与同步"]);
    expect(structure.chapters.every((chapter) => chapter.collapsed)).toBe(true);
  });

  it("caps a noisy 50 question overview while retaining every source question", () => {
    const messages = Array.from({ length: 50 }, (_, index) => question(index, `独立话题 ${index}`));
    const structure = buildConversationStructure(conversation, messages);
    expect(structure.chapters.length).toBeGreaterThanOrEqual(5);
    expect(structure.chapters.length).toBeLessThanOrEqual(9);
    expect(structure.chapters.flatMap((chapter) => chapter.questionIds)).toHaveLength(50);
  });

  it("keeps a 120-question conversation compressed without losing a question", () => {
    const messages = Array.from({ length: 120 }, (_, index) => question(index, `长期项目阶段 ${Math.floor(index / 15) + 1} 的问题 ${index + 1}`));
    const structure = buildConversationStructure(conversation, messages);
    expect(structure.chapters.length).toBeGreaterThanOrEqual(5);
    expect(structure.chapters.length).toBeLessThanOrEqual(9);
    expect(new Set(structure.chapters.flatMap((chapter) => chapter.questionIds))).toHaveLength(120);
  });

  it("keeps repeated topics in the original reading order", () => {
    const messages = [
      "产品定位与目标用户", "Canvas 节点和布局", "产品定位与竞品差异", "Canvas 结构如何优化",
      "历史对话导入", "同步状态恢复", "AI 自动分章", "自动整理质量检查",
    ].map((text, index) => question(index, text));
    const structure = buildConversationStructure(conversation, messages);
    expect(structure.chapters.length).toBeGreaterThanOrEqual(2);
    expect(new Set(structure.chapters.flatMap((chapter) => chapter.questionIds))).toHaveLength(messages.length);
    expect(structure.chapters.flatMap((chapter) => chapter.questionIds)).toEqual(messages.map((message) => `conversation-message-${message.id}`));
    expect(cleanChapterTitle("知识组织的新方法", "知识节点还能怎样组织")).toBe("知识组织的新方法");
    expect(cleanChapterTitle("TurnMap 产品比较", "竞品和产品定位")).toBe("TurnMap 产品比较");
    const repeated = refineChapterGroups([
      { title: "产品定位", questionIds: ["q1"] }, { title: "界面设计", questionIds: ["q2"] }, { title: "产品定位", questionIds: ["q3"] },
    ], new Map([["q1", "产品定位"], ["q2", "界面设计"], ["q3", "产品定位"]]));
    expect(repeated).toHaveLength(3);
  });

  it("compresses an 86-question conversation into a stable backbone", () => {
    const topics = ["产品定位", "Canvas 布局", "导入同步", "AI 自动整理", "知识关系", "工程实现"];
    const messages = Array.from({ length: 86 }, (_, index) => question(index, `${topics[index % topics.length]}：问题 ${index + 1}`));
    const structure = buildConversationStructure(conversation, messages);
    expect(structure.chapters.length).toBeGreaterThanOrEqual(5);
    expect(structure.chapters.length).toBeLessThanOrEqual(9);
    expect(structure.chapters.flatMap((chapter) => chapter.questionIds)).toEqual(messages.map((message) => `conversation-message-${message.id}`));
    expect(structure.chapters.flatMap((chapter) => chapter.questionIds)).toHaveLength(86);
  });

  it("compresses ten short experimental questions into two to four useful chapters", () => {
    const messages = ["实验前要准备什么", "示波器实验怎么接线", "图一图二有什么区别", "实际装置和图示区别", "咋调", "示波器怎么设置", "发生器怎么设置", "频率和幅值怎么选", "继续讲触发设置", "最后怎么记录数据"].map((text, index) => question(index, text));
    const structure = buildConversationStructure(conversation, messages);
    expect(structure.chapters.length).toBeGreaterThanOrEqual(2);
    expect(structure.chapters.length).toBeLessThanOrEqual(4);
    expect(structure.chapters.every((chapter) => [...chapter.title].length >= 4 && [...chapter.title].length <= 12)).toBe(true);
    expect(structure.chapters.map((chapter) => chapter.title)).not.toContain("咋调");
    expect(structure.chapters.every((chapter) => chapter.summary?.endsWith("。"))).toBe(true);
  });
});

it("reads a pasted table or Markdown question as its words", () => {
  expect(questionPlainText("| ★ 确定：默认**专注 25 分钟、休息 5 分钟** |\n| ----------------- |")).toBe("★ 确定：默认专注 25 分钟、休息 5 分钟");
  expect(questionPlainText("★ 第一版**不做数据云同步**，以后再说。")).toBe("★ 第一版不做数据云同步，以后再说。");
  expect(questionPlainText("## 标题\n- 第一点\n1. 第二点 `code`")).toBe("标题 第一点 第二点 code");
});
