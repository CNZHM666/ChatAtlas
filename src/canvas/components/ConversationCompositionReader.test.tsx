import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationGraph, ConversationGraphNode, ConversationMessage } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { ConversationCompositionReader } from "./ConversationCompositionReader";

afterEach(cleanup);

describe("ConversationCompositionReader", () => {
  it("reads cited discussion in the central workspace without leaving ChatAtlas", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const conversation: Conversation = { id: "composition-chat", platform: "chatgpt", title: "控制理论", url: "", messageCount: 2, updatedAt: 1 };
    const question: ConversationMessage = { id: "q1", conversationId: conversation.id, messageIndex: 0, role: "user", content: "什么是极点？", preview: "", contentHash: "q", createdAt: 1, updatedAt: 1 };
    const answer: ConversationMessage = { ...question, id: "a1", messageIndex: 1, role: "assistant", content: "极点与系统动态有关。" };
    const node: ConversationGraphNode = { id: "bridge", conversationId: conversation.id, kind: "bridge", title: "从特征值到极点", description: "它们在状态空间中联系起来。", evidenceRefs: [{ conversationId: conversation.id, messageId: "q1" }], x: 0, y: 0 };
    const graph: ConversationGraph = { conversationId: conversation.id, nodes: [node], edges: [], episodes: [{ id: "episode", chapterId: "chapter", conversationId: conversation.id, title: "系统极点", questionIds: ["q1"], messageIds: ["q1", "a1"] }], updatedAt: 1 };
    render(<PreferencesProvider><ConversationCompositionReader node={node} graph={graph} conversation={conversation} messages={[question, answer]} onClose={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByRole("complementary", { name: "对话知识阅读" })).toHaveTextContent("什么是极点？");
    expect(screen.getByText("极点与系统动态有关。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /在原平台核对/ })).not.toBeInTheDocument();
  });
});
