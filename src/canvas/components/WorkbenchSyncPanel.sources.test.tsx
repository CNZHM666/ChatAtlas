import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
const { searchConversations } = vi.hoisted(() => ({ searchConversations: vi.fn() }));
vi.mock("../../search/message-fulltext", () => ({ messageFullTextSearch: { searchConversations } }));
import { PreferencesProvider } from "../preferences";
import { WorkbenchSyncPanel } from "./WorkbenchSyncPanel";

afterEach(() => { cleanup(); searchConversations.mockReset(); });
const conversations = [
  { id: "orama", platform: "chatgpt", title: "检索方案", messageCount: 4, importState: "complete", hydrationState: "hydrated", updatedAt: 2 },
  { id: "pending", platform: "chatgpt", title: "导出讨论", messageCount: null, importState: "discovered", updatedAt: 1 },
] as Conversation[];
const project = { id: "project-1", title: "检索项目", goal: "整理", mode: "work", sourceConversationIds: ["orama"], sections: [{ id: "s", title: "检索", body: "正文", transition: "", evidenceIds: [], kind: "finding" }], evidence: [], activeSectionId: "s", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 } as FocusSession;
const panel = (props: Partial<Parameters<typeof WorkbenchSyncPanel>[0]> = {}) => {
  localStorage.setItem("atlas-locale", "zh-CN");
  return render(<PreferencesProvider><WorkbenchSyncPanel conversations={conversations} importJob={null} importSource="web" selectedIds={new Set()} onSelectedIds={vi.fn()} onPrioritize={vi.fn()} onScan={vi.fn()} onHydrate={vi.fn()} onZip={vi.fn()} onPause={vi.fn()} onConnect={vi.fn()} sessions={[project]} {...props} /></PreferencesProvider>);
};

it("reads a readable conversation from its row, and names the projects it belongs to", () => {
  const onOpen = vi.fn(), onOpenProject = vi.fn();
  panel({ onOpen, onOpenProject });
  const list = screen.getByRole("group", { name: "选择本次使用的对话" });
  fireEvent.click(within(list).getByRole("button", { name: "阅读原文：检索方案" }));
  expect(onOpen).toHaveBeenCalledWith("orama", undefined, undefined);
  // A conversation with no body yet has nothing to read.
  expect(within(list).queryByRole("button", { name: "阅读原文：导出讨论" })).toBeNull();
  fireEvent.click(within(list).getByRole("button", { name: "1 个项目" }));
  expect(onOpenProject).toHaveBeenCalledWith("project-1");
});

it("adds the selected conversations to a project chosen in place", async () => {
  const onLinkProject = vi.fn(async () => undefined);
  panel({ onOpen: vi.fn(), onOpenProject: vi.fn(), onLinkProject, selectedIds: new Set(["pending"]) });
  fireEvent.click(screen.getByRole("button", { name: "加入项目" }));
  fireEvent.change(screen.getByRole("combobox", { name: "加入哪个项目" }), { target: { value: "project-1" } });
  fireEvent.click(screen.getByRole("button", { name: "加入 1 条" }));
  await waitFor(() => expect(onLinkProject).toHaveBeenCalledWith("project-1", ["pending"]));
  expect(await screen.findByRole("status")).toHaveTextContent("已加入「检索项目」");
});

it("finds a conversation by its message text and shows the matching line", async () => {
  const message = { id: "m", conversationId: "orama", messageIndex: 1, role: "assistant", content: "全文索引使用 Orama", preview: "", contentHash: "h", createdAt: 1, updatedAt: 1 } as ConversationMessage;
  searchConversations.mockResolvedValue({ hits: [{ conversationId: "orama", summary: "…全文索引使用 Orama…", message }] });
  const onOpen = vi.fn();
  panel({ onOpen });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索对话标题" }), { target: { value: "Orama" } });
  expect(await screen.findByText("…全文索引使用 Orama…")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "阅读原文：检索方案" }));
  expect(onOpen).toHaveBeenCalledWith("orama", message, undefined);
});

it("says the project already holds the selection instead of adding it again", async () => {
  const onLinkProject = vi.fn(async () => undefined);
  panel({ onOpen: vi.fn(), onOpenProject: vi.fn(), onLinkProject, selectedIds: new Set(["orama"]) });
  fireEvent.click(screen.getByRole("button", { name: "加入项目" }));
  fireEvent.change(screen.getByRole("combobox", { name: "加入哪个项目" }), { target: { value: "project-1" } });
  fireEvent.click(screen.getByRole("button", { name: "加入 1 条" }));
  expect(await screen.findByRole("status")).toHaveTextContent("所选对话已在「检索项目」中");
  expect(onLinkProject).not.toHaveBeenCalled();
});
