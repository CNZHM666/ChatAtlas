import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationChapter, ConversationGraph, ConversationMessage } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { ChapterReader } from "./ChapterReader";

afterEach(cleanup);

describe("ChapterReader", () => {
  it("uses the stored episodes as its outline and continuous reading sections", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversation: Conversation = { id: "reader-chat", platform: "chatgpt", title: "控制理论", url: "https://chatgpt.com/c/reader-chat", messageCount: 4, updatedAt: 1 };
    const chapter: ConversationChapter = { id: "reader-chapter", conversationId: conversation.id, title: "系统极点", questionIds: ["conversation-message-q1", "conversation-message-q2"], order: 0, collapsed: true, source: "auto", createdAt: 1, updatedAt: 1 };
    const nextChapter: ConversationChapter = { ...chapter, id: "next-chapter", title: "最优控制", questionIds: [], order: 1 };
    const graph: ConversationGraph = { conversationId: conversation.id, nodes: [], edges: [], chapters: [chapter, nextChapter], episodes: [
      { id: "episode-one", conversationId: conversation.id, chapterId: chapter.id, title: "特征值", questionIds: ["q1"], messageIds: ["q1", "a1"] },
      { id: "episode-two", conversationId: conversation.id, chapterId: chapter.id, title: "系统极点与稳定性", contextHeader: "此前讨论了状态矩阵。", questionIds: ["q2"], messageIds: ["q2", "a2"] },
    ], updatedAt: 1 };
    const messages: ConversationMessage[] = [
      { id: "q1", conversationId: conversation.id, messageIndex: 0, role: "user", content: "特征值是什么？", preview: "", contentHash: "q1", createdAt: 1, updatedAt: 1 },
      { id: "a1", conversationId: conversation.id, messageIndex: 1, role: "assistant", content: "它描述线性变换。", preview: "", contentHash: "a1", createdAt: 1, updatedAt: 1 },
      { id: "q2", conversationId: conversation.id, messageIndex: 2, role: "user", content: "那为什么决定稳定性？", preview: "", contentHash: "q2", createdAt: 1, updatedAt: 1 },
      { id: "a2", conversationId: conversation.id, messageIndex: 3, role: "assistant", content: "极点位于左半平面时稳定。", preview: "", contentHash: "a2", createdAt: 1, updatedAt: 1 },
    ];
    const onChapter = vi.fn();
    const { container } = render(<PreferencesProvider><ChapterReader chapter={chapter} graph={graph} conversation={conversation} messages={messages} onClose={vi.fn()} onChapter={onChapter} /></PreferencesProvider>);
    expect(screen.getByRole("navigation", { name: "章节大纲" }).querySelectorAll("button")).toHaveLength(2);
    expect(container.querySelector("#reader-episode-two")).toHaveTextContent("此前讨论了状态矩阵。");
    expect(container.querySelector("#reader-episode-two")).toHaveTextContent("那为什么决定稳定性？");
    expect(container.querySelector("#reader-episode-two")).toHaveTextContent("极点位于左半平面时稳定。");
    expect(screen.getByText("特征值是什么？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /最优控制/ }));
    expect(onChapter).toHaveBeenCalledWith("next-chapter");
    expect(screen.queryByRole("button", { name: "Verify in original app" })).not.toBeInTheDocument();
  });
  it("reads only the questions attached to a manual chapter and keeps unrelated turns out", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversation: Conversation = { id: "manual-reader", platform: "chatgpt", title: "控制理论", url: "https://chatgpt.com/c/manual-reader", messageCount: 6, updatedAt: 1 };
    const chapter: ConversationChapter = { id: "manual-chapter", conversationId: conversation.id, title: "反馈控制", questionIds: ["conversation-message-q1", "conversation-message-q3"], order: 0, collapsed: true, source: "user", createdAt: 1, updatedAt: 1 };
    const graph: ConversationGraph = { conversationId: conversation.id, nodes: [], edges: [], chapters: [chapter], organizationMode: "manual", updatedAt: 1 };
    const messages: ConversationMessage[] = ["q1", "a1", "q2", "a2", "q3", "a3"].map((id, index) => ({ id, conversationId: conversation.id, messageIndex: index, role: id.startsWith("q") ? "user" as const : "assistant" as const, content: id === "q2" ? "Unrelated topic" : id === "a2" ? "Unrelated answer" : `Selected ${id}`, preview: id, contentHash: id, createdAt: index, updatedAt: index }));
    render(<PreferencesProvider><ChapterReader chapter={chapter} graph={graph} conversation={conversation} messages={messages} onClose={vi.fn()} onChapter={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByRole("navigation", { name: "章节大纲" }).querySelectorAll("button")).toHaveLength(2);
    expect(screen.getByText("Selected a1")).toBeInTheDocument();
    expect(screen.getByText("Selected a3")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated topic")).not.toBeInTheDocument();
    expect(screen.queryByText("Unrelated answer")).not.toBeInTheDocument();
  });

  it("includes the preceding exchange when a manual chapter starts with a dependent follow-up", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversation: Conversation = { id: "followup", platform: "chatgpt", title: "方法讨论", url: "", messageCount: 4, updatedAt: 1 };
    const chapter: ConversationChapter = { id: "followup-chapter", conversationId: conversation.id, title: "第二种方法", questionIds: ["conversation-message-q2"], order: 0, collapsed: true, source: "user", createdAt: 1, updatedAt: 1 };
    const graph: ConversationGraph = { conversationId: conversation.id, nodes: [], edges: [], chapters: [chapter], organizationMode: "manual", updatedAt: 1 };
    const messages: ConversationMessage[] = ["q1", "a1", "q2", "a2"].map((id, index) => ({ id, conversationId: conversation.id, messageIndex: index, role: id.startsWith("q") ? "user" as const : "assistant" as const, content: id === "q2" ? "那第二种方法呢？" : id, preview: id, contentHash: id, createdAt: 1, updatedAt: 1 }));
    render(<PreferencesProvider><ChapterReader chapter={chapter} graph={graph} conversation={conversation} messages={messages} onClose={vi.fn()} onChapter={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText("理解这段追问需要的前文")).toBeInTheDocument();
    expect(screen.getByText("a1")).toBeInTheDocument();
    expect(screen.getByText("那第二种方法呢？")).toBeInTheDocument();
  });

  it("does not repeat the chapter title for its only reading section", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversation: Conversation = { id: "single-reader", platform: "chatgpt", title: "对话", url: "https://chatgpt.com/c/single-reader", messageCount: 1, updatedAt: 1 };
    const chapter: ConversationChapter = { id: "single-chapter", conversationId: conversation.id, title: "第一步", questionIds: ["conversation-message-q1"], order: 0, collapsed: true, source: "user", createdAt: 1, updatedAt: 1 };
    const graph: ConversationGraph = { conversationId: conversation.id, nodes: [], edges: [], chapters: [chapter], organizationMode: "manual", updatedAt: 1 };
    const message: ConversationMessage = { id: "q1", conversationId: conversation.id, messageIndex: 0, role: "user", content: "问题内容", preview: "问题内容", contentHash: "q1", createdAt: 1, updatedAt: 1 };
    render(<PreferencesProvider><ChapterReader chapter={chapter} graph={graph} conversation={conversation} messages={[message]} onClose={vi.fn()} onChapter={vi.fn()} /></PreferencesProvider>);
    expect(screen.getAllByText("第一步")).toHaveLength(1);
  });
});
