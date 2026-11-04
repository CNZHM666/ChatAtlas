import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage } from "../../shared/types";
import { addManualChapter, conversationDragType, createManualConversationGraph, generateConversationGraph, saveConversationGraph } from "../conversation-graph";
import { getStoredConversationGraph } from "../../storage/conversation-graphs";
import { PreferencesProvider } from "../preferences";
import { ConversationCanvas } from "./ConversationCanvas";

const conversation: Conversation = { id: "organize-entry-test", platform: "chatgpt", title: "产品规划", url: "https://chatgpt.com/c/organize-entry-test", messageCount: 5, updatedAt: 1 };
const messages: ConversationMessage[] = Array.from({ length: 5 }, (_, index) => ({ id: `entry-q-${index}`, conversationId: conversation.id, messageIndex: index, role: "user", content: `产品问题 ${index}`, preview: `产品问题 ${index}`, contentHash: `${index}`, createdAt: index, updatedAt: index }));

beforeEach(() => {
  localStorage.setItem("atlas-locale", "zh-CN");
  localStorage.removeItem("atlas-conversation-detail-width");
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("conversation canvas organization boundary", () => {
  it("opens a bridge in the central reader in browse mode", async () => {
    const local = { ...conversation, id: "composition-workspace-reading", messageCount: 2 };
    const turns: ConversationMessage[] = [
      { ...messages[0], id: "bridge-question", conversationId: local.id, messageIndex: 0, content: "什么是极点？" },
      { ...messages[0], id: "bridge-answer", conversationId: local.id, messageIndex: 1, role: "assistant", content: "极点表示系统动态。" },
    ];
    const base = generateConversationGraph(local, turns, { chapters: [], questionRelations: [] });
    await saveConversationGraph({ ...base, nodes: [...base.nodes, { id: "bridge-reader-node", conversationId: local.id, kind: "bridge", title: "从特征值到极点", description: "跨越两个讨论阶段。", evidenceRefs: [{ conversationId: local.id, messageId: "bridge-question" }], x: 440, y: 80 }] });
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    const bridge = await screen.findByText("从特征值到极点");
    fireEvent.click(bridge);
    expect(await screen.findByRole("complementary", { name: "对话知识阅读" })).toHaveTextContent("极点表示系统动态。");
    expect(container.querySelector(".conversation-canvas-stage")).toHaveClass("is-reading");
    expect(container.querySelector(".conversation-detail-panel")).not.toBeInTheDocument();
  });
  it("keeps a question card on the canvas without opening a separate reader", async () => {
    const local = { ...conversation, id: "question-workspace-reading", messageCount: 2 };
    const turns: ConversationMessage[] = [
      { ...messages[0], id: "workspace-question", conversationId: local.id, messageIndex: 0, content: "Why are poles useful?", preview: "Why are poles useful?" },
      { ...messages[0], id: "workspace-answer", conversationId: local.id, messageIndex: 1, role: "assistant", content: "They describe stability.", preview: "They describe stability." },
    ];
    await saveConversationGraph({ ...generateConversationGraph(local, turns, { chapters: [], questionRelations: [] }), organizationMode: "manual", userEdited: true });
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    await waitFor(() => expect(container.querySelector(".semantic-question.conversation-node")).toBeInTheDocument());
    fireEvent.click(container.querySelector(".semantic-question.conversation-node")!);
    expect(screen.queryByRole("button", { name: "返回画布" })).not.toBeInTheDocument();
    expect(container.querySelector(".conversation-canvas-stage")).not.toHaveClass("is-reading");
    fireEvent.doubleClick(container.querySelector(".semantic-question.conversation-node")!);
  });

  it("opens a question and its assistant answer locally from the sidebar", async () => {
    const local = { ...conversation, id: "assistant-local-reading", messageCount: 2 };
    const turns: ConversationMessage[] = [
      { ...messages[0], id: "local-question", conversationId: local.id, messageIndex: 0, content: "Why are poles useful?", preview: "Why are poles useful?" },
      { ...messages[0], id: "local-answer", conversationId: local.id, messageIndex: 1, role: "assistant", content: "They describe stability.", preview: "They describe stability." },
    ];
    const chapter = { id: "local-reading-chapter", conversationId: local.id, title: "System poles", questionIds: ["conversation-message-local-question"], order: 0, collapsed: true, source: "user" as const, createdAt: 1, updatedAt: 1 };
    await saveConversationGraph({ ...generateConversationGraph(local, turns, { chapters: [chapter], questionRelations: [] }), organizationMode: "manual", userEdited: true });
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    await waitFor(() => expect(container.querySelector(".conversation-outline-chapter-heading button")).toBeInTheDocument());
    fireEvent.click(container.querySelector(".conversation-outline-chapter-heading button")!);
    expect(await screen.findByRole("complementary", { name: "章节阅读" })).toHaveTextContent("They describe stability.");
  });

  it("opens unassigned questions within the selected conversation instead of the old full transcript", async () => {
    const local = { ...conversation, id: "unassigned-local-reader", messageCount: 4 };
    const turns: ConversationMessage[] = [
      { ...messages[0], id: "assigned-q", conversationId: local.id, messageIndex: 0, content: "Assigned question", preview: "Assigned question" },
      { ...messages[0], id: "assigned-a", conversationId: local.id, messageIndex: 1, role: "assistant", content: "Assigned answer" },
      { ...messages[0], id: "free-q", conversationId: local.id, messageIndex: 2, content: "Unassigned question", preview: "Unassigned question" },
      { ...messages[0], id: "free-a", conversationId: local.id, messageIndex: 3, role: "assistant", content: "Unassigned answer" },
    ];
    const chapter = { id: "assigned-chapter", conversationId: local.id, title: "Assigned chapter", questionIds: ["conversation-message-assigned-q"], order: 0, collapsed: true, source: "user" as const, createdAt: 1, updatedAt: 1 };
    await saveConversationGraph({ ...generateConversationGraph(local, turns, { chapters: [chapter], questionRelations: [] }), organizationMode: "manual", userEdited: true });
    const onSelectConversation = vi.fn();
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={onSelectConversation} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /未归入章节/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /未归入章节/ }));
    const reader = await screen.findByRole("complementary", { name: "未归入章节阅读" });
    expect(reader).toHaveTextContent("Unassigned question");
    expect(reader).toHaveTextContent("Unassigned answer");
    expect(reader).not.toHaveTextContent("Assigned answer");
    expect(container.querySelector(".conversation-canvas-stage")).toHaveClass("is-reading");
    expect(screen.queryByRole("region", { name: "原对话阅读" })).not.toBeInTheDocument();
    expect(onSelectConversation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回对话画布" }));
    fireEvent.click(screen.getByRole("button", { name: /Unassigned question/ }));
    expect(await screen.findByRole("complementary", { name: "未归入章节阅读" })).toHaveTextContent("Unassigned answer");
  });

  it("opens the same chapter outline when a chapter is clicked while editing", async () => {
    const local = { ...conversation, id: "chapter-edit-reading", messageCount: 2 };
    const turns: ConversationMessage[] = [
      { ...messages[0], id: "edit-question", conversationId: local.id, messageIndex: 0, content: "What is feedback?" },
      { ...messages[0], id: "edit-answer", conversationId: local.id, messageIndex: 1, role: "assistant", content: "Feedback compares output with a reference." },
    ];
    const chapter = { id: "edit-chapter", conversationId: local.id, title: "Feedback basics", questionIds: ["conversation-message-edit-question"], order: 0, collapsed: true, source: "user" as const, createdAt: 1, updatedAt: 1 };
    await saveConversationGraph({ ...generateConversationGraph(local, turns, { chapters: [chapter], questionRelations: [] }), organizationMode: "manual", userEdited: true });
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="edit" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    await waitFor(() => expect(container.querySelector(".semantic-chapter.conversation-node")).toBeInTheDocument());
    fireEvent.click(container.querySelector(".semantic-chapter.conversation-node")!);
    expect(await screen.findByRole("complementary", { name: "章节阅读" })).toHaveTextContent("Feedback compares output with a reference.");
  });

  it("attaches a question dropped under a sidebar chapter before placing cards", async () => {
    const local = { ...conversation, id: "manual-sidebar-attachment", messageCount: 2 };
    const turns: ConversationMessage[] = [
      { ...messages[0], id: "attach-question", conversationId: local.id, messageIndex: 0, content: "What is feedback?", preview: "What is feedback?" },
      { ...messages[0], id: "attach-answer", conversationId: local.id, messageIndex: 1, role: "assistant", content: "Feedback compares output with a reference." },
    ];
    const graph = addManualChapter(createManualConversationGraph(local), "Feedback basics");
    await saveConversationGraph(graph);
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="edit" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    await waitFor(() => expect(container.querySelector(".conversation-outline-chapter")).toBeInTheDocument());
    fireEvent.drop(container.querySelector(".conversation-outline-chapter")!, { dataTransfer: { getData: () => JSON.stringify({ kind: "question", conversationId: local.id, messageId: "attach-question" }), types: [conversationDragType] } });
    await waitFor(async () => expect((await getStoredConversationGraph(local.id))?.chapters?.[0]?.questionIds).toEqual(["conversation-message-attach-question"]));
    const stored = (await getStoredConversationGraph(local.id))!;
    expect(stored.nodes.filter((node) => node.kind === "question")).toHaveLength(1);
    expect(stored.edges).toContainEqual(expect.objectContaining({ source: stored.chapters![0].id, target: "conversation-message-attach-question" }));
  });

  it("keeps the organization choice visible until the user chooses to read", async () => {
    const fresh = { ...conversation, id: "fresh-canvas-no-local-chapters" };
    const freshMessages = messages.map((message) => ({ ...message, id: `fresh-${message.id}`, conversationId: fresh.id })).reverse();
    const onStartManual = vi.fn();
    const onGenerateChapters = vi.fn();
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={fresh} conversations={[fresh]} messages={freshMessages} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} onStartManual={onStartManual} onGenerateChapters={onGenerateChapters} /></ReactFlowProvider></PreferencesProvider>);
    expect(await screen.findByRole("region", { name: "选择对话整理方式" })).toBeVisible();
    expect(container.querySelector(".react-flow")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.queryByText("按时间顺序")).not.toBeInTheDocument();
    expect(await getStoredConversationGraph(fresh.id)).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "阅读原对话" }));
    expect(await screen.findByText("按时间顺序")).toBeVisible();
    await waitFor(() => expect(container.querySelectorAll(".semantic-question.conversation-node")).toHaveLength(freshMessages.length));
    expect(container.querySelectorAll(".semantic-question.conversation-node")[0]).toHaveClass("is-selected");
    expect(screen.queryByRole("region", { name: "原对话阅读" })).not.toBeInTheDocument();
    fireEvent.click(container.querySelectorAll(".semantic-question.conversation-node")[0]);
    const reader = await screen.findByRole("complementary", { name: "原对话阅读" });
    expect(reader).toHaveTextContent("产品问题 0");
    expect(container.querySelector(".conversation-canvas-stage")).toHaveClass("is-reading");
    fireEvent.click(screen.getByRole("button", { name: "返回对话画布" }));
    expect(screen.queryByRole("complementary", { name: "原对话阅读" })).not.toBeInTheDocument();
    expect(container.querySelector(".conversation-canvas-stage")).not.toHaveClass("is-reading");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await getStoredConversationGraph(fresh.id)).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "整理此对话" }));
    fireEvent.click(screen.getByRole("button", { name: /自己整理/ }));
    await waitFor(async () => expect(await getStoredConversationGraph(fresh.id)).toMatchObject({ organizationMode: "manual", userEdited: true, chapters: [], edges: [] }));
    expect((await getStoredConversationGraph(fresh.id))?.nodes).toHaveLength(1);
    expect(onStartManual).toHaveBeenCalledOnce();
    expect(onGenerateChapters).not.toHaveBeenCalled();
  });

  it("reads a manual unplaced question in the fixed conversation reader", async () => {
    const local = { ...conversation, id: "manual-unplaced-reader", messageCount: 2 };
    const turns: ConversationMessage[] = [
      { ...messages[0], id: "unplaced-q", conversationId: local.id, messageIndex: 0, content: "What is feedback?", preview: "What is feedback?" },
      { ...messages[0], id: "unplaced-a", conversationId: local.id, messageIndex: 1, role: "assistant", content: "Feedback compares the output with a reference." },
    ];
    await saveConversationGraph(createManualConversationGraph(local));
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /自己整理/ }));
    fireEvent.click(await screen.findByRole("button", { name: /What is feedback/ }));
    expect(await screen.findByRole("complementary", { name: "未归入章节阅读" })).toHaveTextContent("Feedback compares the output with a reference.");
    expect(container.querySelector(".conversation-canvas-stage")).toHaveClass("is-reading");
    expect(screen.queryByRole("region", { name: "原对话阅读" })).not.toBeInTheDocument();
  });

  it("creates and links chapter cards automatically from the sidebar", async () => {
    const local = { ...conversation, id: "manual-chapter-from-sidebar" };
    await saveConversationGraph(createManualConversationGraph(local));
    render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={messages.map((message) => ({ ...message, conversationId: local.id }))} loadingMessages={false} mode="edit" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: /自己整理/ }));
    fireEvent.click(await screen.findByRole("button", { name: "新建章节" }));
    fireEvent.change(screen.getByRole("textbox", { name: "章节名称" }), { target: { value: "控制理论基础" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect((await screen.findAllByText("控制理论基础")).length).toBeGreaterThanOrEqual(2);
    await waitFor(async () => expect((await getStoredConversationGraph(local.id))?.chapters?.[0]?.title).toBe("控制理论基础"));
    fireEvent.click(screen.getByRole("button", { name: "新建章节" }));
    fireEvent.change(screen.getByRole("textbox", { name: "章节名称" }), { target: { value: "系统稳定性" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(async () => expect((await getStoredConversationGraph(local.id))?.chapters).toHaveLength(2));
    const stored = (await getStoredConversationGraph(local.id))!;
    const root = stored.nodes.find((node) => node.kind === "conversation-root")!;
    expect(stored.nodes.filter((node) => node.kind === "chapter")).toHaveLength(2);
    expect(stored.edges.filter((edge) => edge.source === root.id).map((edge) => edge.target)).toEqual(stored.chapters?.map((chapter) => chapter.id));
  });

  it("routes the first AI choice to a reviewable organization task without saving a timeline", async () => {
    const fresh = { ...conversation, id: "fresh-canvas-ai-choice" };
    const freshMessages = messages.map((message) => ({ ...message, id: `ai-${message.id}`, conversationId: fresh.id }));
    const onGenerateChapters = vi.fn();
    render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={fresh} conversations={[fresh]} messages={freshMessages} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} onGenerateChapters={onGenerateChapters} /></ReactFlowProvider></PreferencesProvider>);
    expect(await screen.findByRole("region", { name: "选择对话整理方式" })).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: /在工作台整理/ }));
    expect(onGenerateChapters).toHaveBeenCalledWith(fresh.id);
    expect(await getStoredConversationGraph(fresh.id)).toBeUndefined();
  });

  it("restores organization choices after leaving an empty manual canvas", async () => {
    const local = { ...conversation, id: "manual-empty-reentry" };
    const turns = messages.map((message) => ({ ...message, conversationId: local.id }));
    const onAI = vi.fn();
    const view = () => <PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} onGenerateChapters={onAI} /></ReactFlowProvider></PreferencesProvider>;
    const first = render(view());
    fireEvent.click(await screen.findByRole("button", { name: /自己整理/ }));
    expect(screen.queryByRole("region", { name: "选择对话整理方式" })).not.toBeInTheDocument();
    await waitFor(async () => expect((await getStoredConversationGraph(local.id))?.organizationMode).toBe("manual"));
    first.unmount();
    const second = render(view());
    expect(await screen.findByRole("region", { name: "选择对话整理方式" })).toBeVisible();
    expect(second.container.querySelector(".react-flow")).toBeNull();
    expect(second.container.querySelector(".conversation-manual-hint")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /在工作台整理/ }));
    expect(onAI).toHaveBeenCalledWith(local.id);
  });

  it("reopens organization choices without replacing authored manual chapters", async () => {
    const local = { ...conversation, id: "manual-authored-switch" };
    const turns = messages.map((message) => ({ ...message, conversationId: local.id }));
    const graph = addManualChapter(createManualConversationGraph(local), "我的章节");
    await saveConversationGraph(graph);
    const onAI = vi.fn();
    const onManual = vi.fn();
    render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} onStartManual={onManual} onGenerateChapters={onAI} /></ReactFlowProvider></PreferencesProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /自己整理/ }));
    expect(onManual).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "选择对话整理方式" })).not.toBeInTheDocument();
    expect((await getStoredConversationGraph(local.id))?.chapters).toEqual(graph.chapters);
    fireEvent.click(screen.getByRole("button", { name: "整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /在工作台整理/ }));
    expect(onAI).toHaveBeenCalledWith(local.id);
    expect((await getStoredConversationGraph(local.id))?.chapters).toEqual(graph.chapters);
  });

  it("offers the same choice for a legacy automatic timeline", async () => {
    const local = { ...conversation, id: "legacy-auto-timeline" };
    const turns = messages.map((message) => ({ ...message, id: `legacy-${message.id}`, conversationId: local.id }));
    await saveConversationGraph(generateConversationGraph(local, turns, { chapters: [], questionRelations: [] }));
    render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="browse" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} onStartManual={vi.fn()} onGenerateChapters={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    expect(await screen.findByRole("region", { name: "选择对话整理方式" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /自己整理/ }));
    await waitFor(async () => expect((await getStoredConversationGraph(local.id))?.organizationMode).toBe("manual"));
    expect((await getStoredConversationGraph(local.id))?.nodes).toHaveLength(1);
  });

  it.each(["browse", "edit"] as const)("keeps AI organization under one action in %s mode", async (mode) => {
    await saveConversationGraph({ ...generateConversationGraph(conversation, messages, { chapters: [], questionRelations: [] }), userEdited: true });
    const onGenerateChapters = vi.fn();
    render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={conversation} conversations={[conversation]} messages={messages} loadingMessages={false} mode={mode} onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} onGenerateChapters={onGenerateChapters} /></ReactFlowProvider></PreferencesProvider>);
    expect(await screen.findByRole("button", { name: "整理方式" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "在工作台整理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "概览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "AI 整理到知识空间" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "整理" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "合并章节" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移至新章节" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "整理方式" }));
    fireEvent.click(screen.getByRole("button", { name: /在工作台整理/ }));
    await waitFor(() => expect(onGenerateChapters).toHaveBeenCalledWith(conversation.id));
  });

  it("resizes the shared detail panel with the keyboard and resets on double click", async () => {
    await saveConversationGraph({ ...generateConversationGraph(conversation, messages, { chapters: [], questionRelations: [] }), organizationMode: "manual", userEdited: true });
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={conversation} conversations={[conversation]} messages={messages} loadingMessages={false} mode="edit" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    await waitFor(() => expect(container.querySelector(".semantic-question.conversation-node")).toBeInTheDocument());
    fireEvent.click(container.querySelector(".semantic-question.conversation-node")!);
    const handle = await screen.findByRole("separator", { name: /拖动调整详情栏宽度/ });
    Object.defineProperty(container.querySelector(".conversation-canvas-stage"), "clientWidth", { configurable: true, value: 1100 });
    expect(handle).toHaveAttribute("aria-valuenow", "500");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "516");
    expect(localStorage.getItem("atlas-conversation-detail-width")).toBe("516");
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute("aria-valuenow", "500");
  });

  it("expands a chapter's questions and hides them again without hiding the next chapter", async () => {
    const local = { ...conversation, id: "chapter-branch-toggle", messageCount: 3 };
    const turns = messages.slice(0, 3).map((message) => ({ ...message, conversationId: local.id }));
    const chapters = [
      { id: "branch-chapter-one", conversationId: local.id, title: "第一章", questionIds: turns.slice(0, 2).map((message) => `conversation-message-${message.id}`), order: 0, collapsed: true, source: "user" as const, createdAt: 1, updatedAt: 1 },
      { id: "branch-chapter-two", conversationId: local.id, title: "第二章", questionIds: [`conversation-message-${turns[2].id}`], order: 1, collapsed: true, source: "user" as const, createdAt: 1, updatedAt: 1 },
    ];
    await saveConversationGraph({ ...generateConversationGraph(local, turns, { chapters, questionRelations: [] }), organizationMode: "manual", userEdited: true });
    const { container } = render(<PreferencesProvider><ReactFlowProvider><ConversationCanvas conversation={local} conversations={[local]} messages={turns} loadingMessages={false} mode="edit" onSelectConversation={vi.fn()} createRequest={null} onHistoryChange={vi.fn()} /></ReactFlowProvider></PreferencesProvider>);
    await waitFor(() => expect(container.querySelectorAll(".semantic-chapter.conversation-node")).toHaveLength(2));
    expect(container.querySelectorAll(".semantic-question.conversation-node")).toHaveLength(0);
    fireEvent.click(container.querySelector('[data-id="branch-chapter-one"] [aria-label="展开分支"]')!);
    await waitFor(() => expect(container.querySelectorAll(".semantic-question.conversation-node")).toHaveLength(2));
    expect(container.querySelectorAll(".semantic-chapter.conversation-node")).toHaveLength(2);
    fireEvent.click(container.querySelector('[data-id="branch-chapter-one"] [aria-label="折叠分支"]')!);
    await waitFor(() => expect(container.querySelectorAll(".semantic-question.conversation-node")).toHaveLength(0));
    expect(container.querySelectorAll(".semantic-chapter.conversation-node")).toHaveLength(2);
  });
});
