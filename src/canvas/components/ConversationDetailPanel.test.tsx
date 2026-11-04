import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationGraphNode, ConversationMessage } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { ConversationDetailPanel } from "./ConversationDetailPanel";

const conversation: Conversation = { id: "c-1", platform: "chatgpt", title: "Example discussion", url: "https://chatgpt.com/c/c-1", updatedAt: 1, messageCount: 2 };
const question: ConversationMessage = { id: "q-1", conversationId: "c-1", messageIndex: 0, role: "user", content: "Why complex?", preview: "Why complex?", contentHash: "q", createdAt: 1, updatedAt: 1 };
const answer: ConversationMessage = { ...question, id: "a-1", messageIndex: 1, role: "assistant", content: "A".repeat(700), contentHash: "a" };
const node: ConversationGraphNode = { id: "node-1", conversationId: "c-1", kind: "question", title: "Why complex?", sourceMessageId: "q-1", answerMessageId: "a-1", x: 0, y: 0 };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("question details", () => {
  it("reads the surrounding conversation in ChatAtlas", () => {
    localStorage.setItem("atlas-locale", "en");
    const earlier = { ...question, id: "earlier", messageIndex: -1, content: "What is the background?" };
    const later = { ...question, id: "later", messageIndex: 2, content: "Then why does it matter?" };
    render(<PreferencesProvider><ConversationDetailPanel conversation={conversation} node={node} question={question} answer={answer} messages={[earlier, question, answer, later]} onClose={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText("What is the background?")).toBeInTheDocument();
    expect(screen.getAllByText("Why complex?")).toHaveLength(2);
    expect(screen.getByText("Then why does it matter?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ChatGPT/ })).not.toBeInTheDocument();
  });

  it("keeps imported search-request JSON out of the reading pane", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const searchRequest = { ...answer, id: "search-request", content: '{"query":"用户误删了对话，查找恢复办法"}' };
    const actualAnswer = { ...answer, id: "actual-answer", messageIndex: 2, content: "可以先检查归档的聊天。" };
    const { container } = render(<PreferencesProvider><ConversationDetailPanel conversation={conversation} node={node} question={question} answer={actualAnswer} messages={[question, searchRequest, actualAnswer]} onClose={vi.fn()} /></PreferencesProvider>);
    expect(container).toHaveTextContent("可以先检查归档的聊天。");
    expect(container).not.toHaveTextContent('"query"');
  });

  it("collapses a long answer visually and expands it", () => {
    localStorage.setItem("atlas-locale", "en");
    render(<PreferencesProvider><ConversationDetailPanel conversation={conversation} node={node} question={question} answer={answer} onClose={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText("A".repeat(700))).toBeInTheDocument();
    expect(document.querySelector(".conversation-answer-frame")).toHaveClass("is-collapsed");
    expect(screen.queryByText("Original question")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read full answer" }));
    expect(screen.getByText("A".repeat(700))).toBeInTheDocument();
    expect(document.querySelector(".conversation-answer-frame")).not.toHaveClass("is-collapsed");
    expect(screen.queryByRole("button", { name: /ChatGPT/ })).not.toBeInTheDocument();
  });

  it("does not repeat the original question and never invents a missing answer", () => {
    localStorage.setItem("atlas-locale", "en");
    const longQuestion = { ...question, content: "Q".repeat(280) };
    const staleNode = { ...node, answerPreview: "Stale stored preview", answerCharCount: 99 };
    render(<PreferencesProvider><ConversationDetailPanel conversation={conversation} node={staleNode} question={longQuestion} onClose={vi.fn()} /></PreferencesProvider>);
    expect(screen.queryByText("Q".repeat(280))).not.toBeInTheDocument();
    expect(screen.queryByText("Original question")).not.toBeInTheDocument();
    expect(screen.getByText("No AI answer yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ChatGPT/ })).not.toBeInTheDocument();
  });

  it("shows an explicit state in the workspace when the original question has not loaded", () => {
    localStorage.setItem("atlas-locale", "en");
    render(<PreferencesProvider><ConversationDetailPanel conversation={conversation} node={node} workspace loadingMessages onClose={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByRole("button", { name: "Back to canvas" })).toBeVisible();
    expect(screen.getByText("Loading the original discussion…")).toBeVisible();
  });

  it("opens the workspace at the selected question within a long conversation", () => {
    localStorage.setItem("atlas-locale", "en");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const top = this.dataset.readerTarget === "true" ? 560 : 0;
      return { top, bottom: top + 40, left: 0, right: 800, width: 800, height: 40, x: 0, y: top, toJSON: () => ({}) };
    });
    const earlier = Array.from({ length: 12 }, (_, index) => ({ ...question, id: `earlier-${index}`, messageIndex: index, content: `Earlier message ${index}` }));
    const selected = { ...question, messageIndex: 12 };
    const response = { ...answer, messageIndex: 13 };
    const { container } = render(<PreferencesProvider><ConversationDetailPanel conversation={conversation} node={node} question={selected} answer={response} messages={[...earlier, selected, response]} workspace onClose={vi.fn()} /></PreferencesProvider>);
    expect(container.querySelector("[data-reader-target='true']")).toHaveTextContent("Why complex?");
    expect(container.querySelector(".conversation-detail-panel")?.scrollTop).toBe(464);
  });

  it("renders Markdown structure without executing raw HTML or unsafe links", () => {
    localStorage.setItem("atlas-locale", "en");
    const markdown = { ...answer, content: "**Overview**\n\n1. First item\n\n```text\nTop right: synced\n```\n\n[unsafe](javascript:alert(1))\n\n<script>alert('x')</script>" };
    const { container } = render(<PreferencesProvider><ConversationDetailPanel conversation={conversation} node={node} question={question} answer={markdown} onClose={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText("Overview").tagName).toBe("STRONG");
    expect(screen.getByText("First item").closest("ol")).toBeInTheDocument();
    expect(screen.getByText("Top right: synced").closest("pre")).toBeInTheDocument();
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect(container.querySelector('a[href^="javascript:"]')).not.toBeInTheDocument();
  });
});
