import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OriginalReader } from "./OriginalReader";
import { PreferencesProvider } from "../preferences";
import { saveSourceReadingPosition, sourceReadingPosition } from "../source-reading-position";
import type { Conversation, ConversationMessage } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("original conversation layout", () => {
  it("shows the shared outline beside the original discussion and a retryable empty state", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const back = vi.fn();
    const { container } = render(<PreferencesProvider><OriginalReader conversation={{ id: "original", title: "稳定性条件", platform: "chatgpt", url: "", messageCount: 0, updatedAt: 1 }} messages={[]} loading={false} onBack={back} /></PreferencesProvider>);
    expect(container.querySelector(".conversation-sidebar")).toBeInTheDocument();
    expect(screen.getByText("本地正文尚未就绪，请同步后重试。")).toBeVisible();
    expect(screen.queryByText("在工作台复习")).not.toBeInTheDocument();
    expect(screen.queryByText("查看思路图")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起侧边栏" }));
    const header = container.querySelector("header")!;
    expect(header.querySelector(".source-reader-title")!.firstElementChild).toBe(within(header).getByRole("button", { name: "全部对话" }));
    fireEvent.click(within(header).getByRole("button", { name: "全部对话" })); expect(back).toHaveBeenCalledOnce();
    localStorage.removeItem("atlas-conversation-sidebar-collapsed");
  });

  it("shows a loading error with a retry action instead of a blank reader", () => {
    localStorage.setItem("atlas-locale", "en");
    const retry = vi.fn();
    render(<PreferencesProvider><OriginalReader conversation={{ id: "retry-reader", title: "Retry", platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 }} messages={[]} loading={false} error="IndexedDB unavailable" onBack={vi.fn()} onRetry={retry} /></PreferencesProvider>);
    expect(screen.getByRole("alert")).toHaveTextContent("IndexedDB unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

it("keeps the selected exchange readable without painting entire messages and preserves consecutive answers", async () => {
  localStorage.setItem("atlas-locale", "en");
  const conversation: Conversation = { id: "focused-pair", title: "Focus source", platform: "chatgpt", url: "", messageCount: 5, updatedAt: 1 };
  const messages: ConversationMessage[] = ["First question", "Answer one", "Further explanation", "Second question", "Answer two"].map((content, index) => ({ id: `pair-${index}`, conversationId: conversation.id, messageIndex: index, role: index === 0 || index === 3 ? "user" : "assistant", content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 }));
  const { container } = render(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} targetMessageId="pair-1" onBack={vi.fn()} /></PreferencesProvider>);
  await waitFor(() => expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(3));
  expect(container.querySelectorAll(".is-selected-turn, .is-highlighted-reply")).toHaveLength(0);
  expect(container.querySelector(".source-reader-header")!.parentElement).not.toHaveClass("original-reading-body");
  expect(screen.getByRole("button", { name: "Exit focus" })).toBeInTheDocument();
  expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(3);
  expect(container.querySelector(".reader-conversation")).not.toHaveTextContent("Second question");
  fireEvent.click(within(container.querySelector(".conversation-sidebar") as HTMLElement).getByRole("button", { name: /Second question/ }));
  await waitFor(() => expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(2));
  expect(container.querySelector(".reader-conversation")).toHaveTextContent("Answer two");
  fireEvent.click(screen.getByRole("button", { name: "Exit focus" }));
  expect(screen.getByRole("button", { name: /Read earlier/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Read earlier/ }));
  await waitFor(() => expect(container.querySelectorAll("[data-reader-message-id]")).toHaveLength(5));
});


it("restores a saved question after reload while an explicit answer citation takes priority", async () => {
  localStorage.setItem("atlas-locale", "en");
  const conversation: Conversation = { id: "persist-source", title: "Reading again", platform: "chatgpt", url: "", messageCount: 4, updatedAt: 1 };
  const messages: ConversationMessage[] = ["First question", "First answer", "Later question", "Later answer"].map((content, index) => ({ id: `persist-${index}`, conversationId: conversation.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 }));
  saveSourceReadingPosition(conversation.id, "persist-2");
  const first = render(<PreferencesProvider><OriginalReader conversation={conversation} messages={[]} loading onBack={vi.fn()} /></PreferencesProvider>);
  expect(sourceReadingPosition(conversation.id)).toBe("persist-2");
  first.rerender(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} onBack={vi.fn()} /></PreferencesProvider>);
  await waitFor(() => expect(first.container.querySelector(".conversation-message-item.is-current")).toHaveTextContent("Later question"));
  expect(screen.queryByRole("button", { name: "Overview" })).not.toBeInTheDocument();
  first.unmount();
  const cited = render(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} targetMessageId="persist-1" onBack={vi.fn()} /></PreferencesProvider>);
  await waitFor(() => expect(cited.container.querySelector(".conversation-message-item.is-current")).toHaveTextContent("First question"));
  expect(sourceReadingPosition(conversation.id)).toBe("persist-0");
  fireEvent.click(screen.getByRole("button", { name: "Next question" }));
  expect(sourceReadingPosition(conversation.id)).toBe("persist-2");
  cited.rerender(<PreferencesProvider><OriginalReader conversation={conversation} messages={[...messages]} loading={false} targetMessageId="persist-1" onBack={vi.fn()} /></PreferencesProvider>);
  expect(sourceReadingPosition(conversation.id)).toBe("persist-2");
  cited.unmount();
  saveSourceReadingPosition(conversation.id, "deleted-question");
  const deleted = render(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} onBack={vi.fn()} /></PreferencesProvider>);
  await waitFor(() => expect(deleted.container.querySelector(".reader-conversation")).toHaveTextContent("First question"));
  expect(deleted.container.querySelector(".knowledge-reader-message.is-focused")).toBeNull();
});

it("opens the original platform and exposes only saved related projects", async () => {
  localStorage.setItem("atlas-locale", "en");
  const conversation: Conversation = { id: "project-source", title: "Material", platform: "chatgpt", url: "https://chatgpt.com/c/project-source", messageCount: 0, updatedAt: 1 };
  const saved: FocusSession = { id: "saved-project", canvasId: "project", status: "ready", title: "Saved project", goal: "Review", mode: "review", sourceConversationIds: [conversation.id], sections: [], evidence: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
  const organize = vi.fn(), open = vi.fn();
  render(<PreferencesProvider><OriginalReader conversation={conversation} messages={[]} loading={false} reviews={[saved, { ...saved, id: "draft", status: "preview" }]} onOrganize={organize} onOpenReview={open} onBack={vi.fn()} /></PreferencesProvider>);
  fireEvent.click(screen.getByRole("button", { name: "View project" }));
  expect(open).toHaveBeenCalledWith(saved.id);
  expect(screen.getByRole("link", { name: "Open in ChatGPT" })).toHaveAttribute("href", conversation.url);
  expect(screen.queryByRole("button", { name: "Organize on Workbench" })).not.toBeInTheDocument();
  expect(organize).not.toHaveBeenCalled();
  expect(screen.queryByText("draft")).not.toBeInTheDocument();
});
it("opens a message-level match directory and restores the existing question outline without losing its filter", async () => {
  localStorage.setItem("atlas-locale", "zh-CN"); localStorage.removeItem("atlas-conversation-sidebar-collapsed");
  const conversation: Conversation = { id: "match-reader", title: "匹配对话", platform: "chatgpt", url: "https://chatgpt.com/c/match-reader", messageCount: 4, updatedAt: 1 };
  const messages: ConversationMessage[] = ["第一个问题", "首次说明 Orama 索引", "第二个问题", "后来修正 Orama 缓存"].map((content, index) => ({ id: `match-${index}`, conversationId: conversation.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 }));
  const hits = [1, 3].map(index => ({ messageId: messages[index].id, excerpt: "Orama", sourceRange: { start: messages[index].content.indexOf("Orama"), end: messages[index].content.indexOf("Orama") + 5, excerpt: "Orama" } }));
  const { container } = render(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} targetMessageId="match-1" searchContext={{ query: "Orama", hits }} onBack={vi.fn()}/></PreferencesProvider>);
  const sidebar = screen.getByRole("complementary", { name: "命中目录" });
  expect(within(sidebar).getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(within(sidebar).getByRole("button", { name: /AI · 4/ }));
  await waitFor(() => expect(container.querySelector(".reader-evidence-target")).toHaveTextContent("后来修正 Orama 缓存"));
  fireEvent.click(screen.getByRole("button", { name: "返回原目录" }));
  expect(screen.queryByRole("complementary", { name: "命中目录" })).not.toBeInTheDocument();
  const filter = screen.getByRole("textbox", { name: "搜索问题或回答" }); fireEvent.change(filter, { target: { value: "第二个问题" } });
  fireEvent.click(screen.getByRole("button", { name: "返回命中目录" }));
  fireEvent.click(screen.getByRole("button", { name: "返回原目录" }));
  expect(screen.getByRole("textbox", { name: "搜索问题或回答" })).toHaveValue("第二个问题");
});

it("uses the current reading question when opening the original platform instead of the initial search hit", async () => {
  localStorage.setItem("atlas-locale", "en"); localStorage.removeItem("atlas-conversation-sidebar-collapsed");
  const native = await import("../open-native-discussion"); const open = vi.spyOn(native, "openNativeDiscussion").mockResolvedValue("located");
  vi.stubGlobal("chrome", { tabs: { query: vi.fn() } });
  const conversation: Conversation = { id: "native-reader", title: "Native", platform: "chatgpt", url: "https://chatgpt.com/c/native-reader", messageCount: 4, updatedAt: 1 };
  const messages: ConversationMessage[] = ["Initial question", "Initial reply", "Current question", "Current reply"].map((content, index) => ({ id: `native-${index}`, conversationId: conversation.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 }));
  render(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} targetMessageId="native-1" onBack={vi.fn()}/></PreferencesProvider>);
  fireEvent.click(screen.getByRole("button", { name: /02 Current question/ }));
  fireEvent.click(screen.getByRole("link", { name: "Open in ChatGPT" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(conversation, messages, "native-2"));
});

it("leads back to the citing chapter and the chapter's next evidence", async () => {
  localStorage.setItem("atlas-locale", "en");
  const conversation: Conversation = { id: "cite-source", title: "Cited source", platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 };
  const messages: ConversationMessage[] = ["Question", "Answer"].map((content, index) => ({ id: `cite-${index}`, conversationId: conversation.id, messageIndex: index, role: index ? "assistant" : "user", content, preview: content, contentHash: content, createdAt: 1, updatedAt: 1 }));
  const review = { id: "cite-review", title: "Project", goal: "", mode: "work", sourceConversationIds: [conversation.id], sections: [{ id: "chapter", title: "Chapter A", evidenceIds: ["e"] }], evidence: [{ id: "e", conversationId: conversation.id, messageId: "cite-1", title: "", excerpt: "Answer" }], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 } as unknown as FocusSession;
  const onOpenChapter = vi.fn(), onNext = vi.fn(), onChapter = vi.fn();
  render(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} reviews={[review]} onBack={vi.fn()} onOpenChapter={onOpenChapter} evidenceSteps={{ index: 0, total: 2, onPrevious: vi.fn(), onNext, onChapter, chapterLabel: "Back to chapter" }} /></PreferencesProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Cited in Chapter A; open" }));
  expect(onOpenChapter).toHaveBeenCalledWith("cite-review", "chapter");
  const steps = screen.getByRole("navigation", { name: "Evidence navigation" });
  expect(within(steps).getByRole("button", { name: "Previous evidence" })).toBeDisabled();
  fireEvent.click(within(steps).getByRole("button", { name: "Next evidence" }));
  fireEvent.click(within(steps).getByRole("button", { name: "Back to chapter" }));
  expect(onNext).toHaveBeenCalled(); expect(onChapter).toHaveBeenCalled();
});
