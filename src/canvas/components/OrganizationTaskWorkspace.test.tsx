import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage, OrganizationRun } from "../../shared/types";
import { saveConversationCapture } from "../../storage/messages";
import { PreferencesProvider } from "../preferences";
import { OrganizationTaskWorkspace } from "./OrganizationTaskWorkspace";
import { TaskSidebarSection } from "./TaskSidebarSection";

const conversation: Conversation = { id: "task-source-conversation", platform: "chatgpt", title: "Control discussion", url: "https://chatgpt.com/c/test", updatedAt: 1, messageCount: 1 };
const message: ConversationMessage = { id: "task-source-message", conversationId: conversation.id, messageIndex: 0, role: "user", content: "How are system poles related to eigenvalues?", preview: "System poles and eigenvalues", contentHash: "hash", createdAt: 2, updatedAt: 2 };
const run: OrganizationRun = { id: "task-ui", title: "Control organization", targetType: "knowledge_space", targetIds: [conversation.id], startedAt: 1, updatedAt: 2, status: "waiting_review", stage: "proposal_ready", progress: 100, proposalId: "proposal-ui", events: [{ type: "concept_found", title: "System poles", sourceRefs: [{ conversationId: conversation.id, messageId: message.id }], timestamp: 2 }] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("organization task workspace", () => {
  it("opens the original discussion from a partial directory without applying a proposal", async () => {
    localStorage.setItem("atlas-locale", "en");
    await saveConversationCapture({ conversation, messages: [message], capturedAt: 1 });
    const onOpen = vi.fn(); const onApply = vi.fn();
    render(<PreferencesProvider><OrganizationTaskWorkspace run={{ ...run, targetType: "conversation", status: "running", stage: "structure_planning", partialChapters: [{ id: "partial", conversationId: conversation.id, title: "Ready chapter", questionIds: [`conversation-message-${message.id}`], order: 0, collapsed: true, source: "auto", createdAt: 1, updatedAt: 1 }] }} conversations={[conversation]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={vi.fn()} onApply={onApply} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onOpenConversation={onOpen} /></PreferencesProvider>);
    expect(screen.getByText(/outline is still being organized/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ready chapter" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(conversation.id, expect.objectContaining({ id: message.id })));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Apply all" })).not.toBeInTheDocument();
  });

  it("hides the sidebar section when there are no tasks", () => {
    localStorage.setItem("atlas-locale", "en");
    render(<PreferencesProvider><TaskSidebarSection runs={[]} activeId={null} onSelect={vi.fn()} onHistory={vi.fn()} /></PreferencesProvider>);
    expect(screen.queryByRole("region", { name: "Tasks" })).not.toBeInTheDocument();
  });

  it("shows only actionable sidebar jobs without a duplicate history shortcut",()=>{
    localStorage.setItem("atlas-locale","en");
    render(<PreferencesProvider><TaskSidebarSection runs={[run,{...run,id:"diagnostic",title:"Wiki diagnostics",diagnosticOnly:true,status:"failed"},{...run,id:"done",title:"Finished job",status:"completed",updatedAt:Date.now()}]} activeId={null} onSelect={vi.fn()} onHistory={vi.fn()}/></PreferencesProvider>);
    expect(screen.getByRole("button",{name:/Control organization/})).toBeVisible();
    expect(screen.queryByRole("button",{name:/Wiki diagnostics|Finished job|Organization history/})).toBeNull();
  });

  it("opens cited evidence on the right and keeps the minutes visible", async () => {
    localStorage.setItem("atlas-locale", "en");
    await saveConversationCapture({ conversation, messages: [message], capturedAt: 2 });
    const onOpenConversation = vi.fn();
    const props = { run, conversations: [conversation], onBack: vi.fn(), onApply: vi.fn(), onDiscard: vi.fn(), onViewChanges: vi.fn(), onRetry: vi.fn(), onCancel: vi.fn(), onOpenConversation };
    const onSourceRefs = vi.fn();
    const { rerender } = render(<PreferencesProvider><OrganizationTaskWorkspace {...props} sourceRefs={null} onSourceRefs={onSourceRefs} /></PreferencesProvider>);
    expect(screen.getByRole("heading", { name: "Control organization" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /1 source/ }));
    expect(onSourceRefs).toHaveBeenCalledWith([{ conversationId: conversation.id, messageId: message.id }]);
    rerender(<PreferencesProvider><OrganizationTaskWorkspace {...props} sourceRefs={[{ conversationId: conversation.id, messageId: message.id }]} onSourceRefs={onSourceRefs} /></PreferencesProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: /Read in ChatAtlas/ })).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /Read in ChatAtlas/ }));
    expect(onOpenConversation).toHaveBeenCalledWith(conversation.id, expect.objectContaining({ id: message.id }));
    expect(screen.queryByRole("button", { name: /Open original message/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "System poles" })).toBeVisible();
  });

  it("shows actual running work and offers cancellation without covering the minutes", () => {
    localStorage.setItem("atlas-locale", "en");
    const onCancel = vi.fn();
    render(<PreferencesProvider><OrganizationTaskWorkspace run={{ ...run, status: "running", stage: "relation_analysis", progress: 62, work: { current: 14, total: 23 } }} conversations={[conversation]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={onCancel} onOpenConversation={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText("14/23")).toBeVisible();
    expect(screen.queryByRole("region", { name: "AI work checklist" })).not.toBeInTheDocument();
    expect(screen.queryByText("62%")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "System poles" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows provider authorization at the blocked step", () => {
    localStorage.setItem("atlas-locale", "en");
    const onAuthorize = vi.fn();
    render(<PreferencesProvider><OrganizationTaskWorkspace run={{ ...run, status: "failed", stage: "preparing", progress: 0, error: "AI provider access is missing. Open Settings → AI, test the connection, then retry." }} conversations={[conversation]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onAuthorize={onAuthorize} onOpenConversation={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Model access required");
    fireEvent.click(screen.getByRole("button", { name: "Grant access and retry" }));
    expect(onAuthorize).toHaveBeenCalledOnce();
  });

  it("makes replacement of a manually edited conversation canvas explicit at review", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const proposal = { ...run, conversationProposals: [{ conversationId: conversation.id, graph: { conversationId: conversation.id, nodes: [], edges: [], chapters: [{ id: "chapter", conversationId: conversation.id, title: "控制系统", questionIds: [], order: 0, collapsed: true, source: "auto" as const, createdAt: 1, updatedAt: 2 }], updatedAt: 2 }, baselineGraphUpdatedAt: 1, replacesUserEdited: true }] };
    render(<PreferencesProvider><OrganizationTaskWorkspace run={proposal} conversations={[conversation]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onOpenConversation={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText(/手动编辑。应用后/)).toBeVisible();
    expect(screen.getByText("控制系统")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用全部" })).toBeVisible();
  });

  it("warns before a direct AI organization replaces manual conversation edits", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    render(<PreferencesProvider><OrganizationTaskWorkspace run={{ ...run, targetType: "conversation", proposalGraph: { conversationId: conversation.id, nodes: [], edges: [], chapters: [], updatedAt: 2 }, replacesUserEdited: true }} conversations={[conversation]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onOpenConversation={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText(/这段对话已有手动整理。应用 AI 建议将替换现有画布/)).toBeVisible();
  });

  it("offers source reselection when a queued source has disappeared", () => {
    localStorage.setItem("atlas-locale", "en");
    const onSelectSources = vi.fn();
    render(<PreferencesProvider><OrganizationTaskWorkspace run={{ ...run, status: "failed", stage: "preparing", error: "Some selected conversations are no longer available. Re-select sources and retry." }} conversations={[]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onSelectSources={onSelectSources} onOpenConversation={vi.fn()} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Select sources again" }));
    expect(onSelectSources).toHaveBeenCalledOnce();
  });

  it("puts the back action at the workspace edge and explains missing model configuration", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const onBack = vi.fn();
    const onConfigureAI = vi.fn();
    const { container } = render(<PreferencesProvider><OrganizationTaskWorkspace run={{ ...run, status: "failed", stage: "preparing", error: "Configure an AI provider first" }} conversations={[conversation]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={onBack} onApply={vi.fn()} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onConfigureAI={onConfigureAI} onOpenConversation={vi.fn()} /></PreferencesProvider>);
    const back = screen.getByRole("button", { name: "返回" });
    expect(back.parentElement).toHaveClass("organization-workspace");
    expect(screen.queryByText("AI 整理工作区")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "先连接 AI 模型" })).toBeVisible();
    expect(container.querySelector(".organization-error")).toHaveTextContent("在 AI 设置中完成配置后");
    fireEvent.click(screen.getByRole("button", { name: "打开 AI 设置" }));
    fireEvent.click(back);
    expect(onConfigureAI).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("offers an API connection for historical shared-service tasks", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const onSelectSources = vi.fn();
    render(<PreferencesProvider><OrganizationTaskWorkspace run={{ ...run, status: "failed", stage: "conversation_profiles", errorCode: "DEMO_BUDGET_EXHAUSTED", error: "ChatAtlas AI 共享额度不足。" }} conversations={[conversation]} sourceRefs={null} onSourceRefs={vi.fn()} onBack={vi.fn()} onApply={vi.fn()} onDiscard={vi.fn()} onViewChanges={vi.fn()} onRetry={vi.fn()} onCancel={vi.fn()} onConfigureAI={vi.fn()} onSelectSources={onSelectSources} onOpenConversation={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByRole("heading", { name: "请连接自己的 AI" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "AI 工作清单" })).not.toBeInTheDocument();
    expect(screen.getByText(/这项旧任务使用的共享服务已停用/)).toBeVisible();
    expect(screen.getByRole("button", { name: "连接自己的 AI" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "调整对话来源" }));
    expect(onSelectSources).toHaveBeenCalledOnce();
  });
});
