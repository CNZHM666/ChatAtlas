import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { conversationDragType } from "../conversation-graph";
import { ConversationSidebar } from "./ConversationSidebar";

const conversation: Conversation = { id: "sidebar-1", platform: "chatgpt", title: "Sidebar test", url: "https://chatgpt.com/c/sidebar-1", updatedAt: 1, messageCount: 3 };
const messages: ConversationMessage[] = [
  { id: "q1", conversationId: "sidebar-1", messageIndex: 0, role: "user", content: "First question", preview: "First question", contentHash: "q1", createdAt: 1, updatedAt: 1 },
  { id: "a1", conversationId: "sidebar-1", messageIndex: 1, role: "assistant", content: "Assistant answer", preview: "Assistant answer", contentHash: "a1", createdAt: 2, updatedAt: 2 },
  { id: "q2", conversationId: "sidebar-1", messageIndex: 2, role: "user", content: "Second question", preview: "Second question", contentHash: "q2", createdAt: 3, updatedAt: 3 },
];
afterEach(cleanup);

it("finds answer text inside a grouped episode and opens the actual matching question", async () => {
  localStorage.setItem("atlas-locale", "en");
  const onSelect = vi.fn();
  const answer = { ...messages[1], id: "a2", messageIndex: 3, content: "Distinctive eigenvalue condition" };
  render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={[...messages, answer]} editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={onSelect} chapters={[{ id: "chapter-search", conversationId: conversation.id, title: "Topic", questionIds: ["conversation-message-q1", "conversation-message-q2"], order: 0, collapsed: false, source: "auto", createdAt: 1, updatedAt: 1 }]} episodes={[{ id: "episode-search", conversationId: conversation.id, chapterId: "chapter-search", title: "Grouped discussion", questionIds: ["conversation-message-q1", "conversation-message-q2"], messageIds: ["q1", "a1", "q2", "a2"] }]} /></PreferencesProvider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Find chapters or questions" }), { target: { value: "eigenvalue" } });
  fireEvent.click(await screen.findByRole("button", { name: /Second question/ }));
  expect(onSelect).toHaveBeenCalledWith(messages[2]);
  expect(screen.queryByRole("button", { name: /First question/ })).not.toBeInTheDocument();
});

describe("conversation sidebar", () => {
  it("shows only questions in the organizing sidebar", () => {
    localStorage.setItem("atlas-locale", "en");
    render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={messages} editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} /></PreferencesProvider>);
    const list = screen.getByLabelText("Conversation messages");
    expect(list.querySelectorAll(".conversation-message-item")).toHaveLength(2);
    expect(list.textContent).toContain("First question");
    expect(list.textContent).toContain("Second question");
    expect(list.textContent).not.toContain("Assistant answer");
    expect(screen.queryByRole("button", { name: "All messages" })).not.toBeInTheDocument();
  });

  it("highlights a selected canvas question and sends sidebar clicks back to the canvas", () => {
    localStorage.setItem("atlas-locale", "en");
    const onSelectMessage = vi.fn();
    const { container } = render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={messages} editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={onSelectMessage} selectedMessageId="q2" /></PreferencesProvider>);
    const second = container.querySelector<HTMLButtonElement>(".conversation-message-item.is-current")!;
    expect(second).toHaveAttribute("aria-current", "true");
    fireEvent.click(second);
    expect(onSelectMessage).toHaveBeenCalledWith(messages[2]);
  });

  it("keeps chapter questions inside the same sidebar outline", () => {
    localStorage.setItem("atlas-locale", "en");
    const onSelectChapter = vi.fn();
    render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={messages} editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} chapters={[{ id: "chapter-one", conversationId: conversation.id, title: "Core idea", questionIds: ["conversation-message-q1", "conversation-message-q2"], order: 0, collapsed: true, source: "auto", createdAt: 1, updatedAt: 1 }]} onSelectChapter={onSelectChapter} /></PreferencesProvider>);
    expect(screen.getByLabelText("Chapters")).toBeVisible();
    expect(screen.queryByLabelText("Conversation messages")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sidebar test" })).toBeVisible();
    expect(screen.getByText("1 chapters · 2 questions")).toBeVisible();
    expect(document.querySelector(".conversation-outline-intro .eyebrow")).toBeNull();
    expect(screen.queryByText("Current conversation")).not.toBeInTheDocument();
    expect(screen.queryByText(/3 messages/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Core idea/ }));
    expect(onSelectChapter).toHaveBeenCalledWith("chapter-one");
    fireEvent.click(screen.getByRole("button", { name: "Expand questions" }));
    expect(screen.getByLabelText("Chapters").textContent).toContain("First question");
    expect(screen.getByLabelText("Chapters").textContent).toContain("Second question");
    fireEvent.click(screen.getByRole("button", { name: "More outline actions" }));
    fireEvent.click(screen.getByRole("button", { name: "View all questions" }));
    expect(screen.getByLabelText("Conversation messages").textContent).toContain("First question");
  });

  it("offers an expand button when collapsed", () => {
    localStorage.setItem("atlas-locale", "en");
    const onToggleCollapsed = vi.fn();
    const { container } = render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={messages} editable={false} showingAll={false} collapsed onToggleCollapsed={onToggleCollapsed} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} /></PreferencesProvider>);
    expect(container.querySelector(".conversation-sidebar.is-collapsed")).toBeInTheDocument();
    expect(screen.queryByLabelText("Conversation messages")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it("keeps an empty conversation header compact", () => {
    localStorage.setItem("atlas-locale", "en");
    const { container } = render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={[]} editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} /></PreferencesProvider>);
    expect(container.querySelector(".conversation-outline-intro h2")?.textContent).toBe("Sidebar test");
    expect(container.querySelector(".conversation-outline-intro p, .conversation-outline-search")).toBeNull();
  });

  it("lets manual organizers create chapters and keeps assigned questions out of the inbox", () => {
    localStorage.setItem("atlas-locale", "en");
    const onCreateChapter = vi.fn();
    const onAssignQuestion = vi.fn();
    render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={messages} editable showingAll={false} manual chapters={[{ id: "chapter-one", conversationId: conversation.id, title: "Core idea", questionIds: ["conversation-message-q1"], order: 0, collapsed: true, source: "user", createdAt: 1, updatedAt: 1 }]} onCreateChapter={onCreateChapter} onAssignQuestion={onAssignQuestion} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByText("Unassigned questions")).toBeVisible();
    expect(screen.getByLabelText("Conversation messages").textContent).toContain("Second question");
    expect(screen.getByLabelText("Conversation messages").textContent).not.toContain("First question");
    fireEvent.click(screen.getByRole("button", { name: "Expand questions" }));
    expect(screen.getByLabelText("Chapters").textContent).toContain("First question");
    const dragData = { effectAllowed: "none", setData: vi.fn(), getData: () => JSON.stringify({ kind: "question", conversationId: conversation.id, messageId: "q2" }) };
    fireEvent.dragStart(screen.getByText("Second question").closest("button")!, { dataTransfer: dragData });
    expect(dragData.effectAllowed).toBe("copyMove");
    const transfer = { types: [conversationDragType], dropEffect: "move", getData: () => JSON.stringify({ kind: "question", conversationId: conversation.id, messageId: "q2" }) };
    expect(fireEvent.dragOver(screen.getByText("Core idea").closest(".conversation-outline-chapter")!, { dataTransfer: { ...transfer, types: [] } })).toBe(false);
    fireEvent.drop(screen.getByText("Core idea").closest(".conversation-outline-chapter")!, { dataTransfer: transfer });
    expect(onAssignQuestion).toHaveBeenCalledWith("chapter-one", "q2");
    fireEvent.click(screen.getByRole("button", { name: "New chapter" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Chapter title" }), { target: { value: "Next idea" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onCreateChapter).toHaveBeenCalledWith("Next idea");
  });

  it("shows a saved question title when an imported question has no readable preview", () => {
    localStorage.setItem("atlas-locale", "en");
    const blank = { ...messages[0], content: "", preview: "" };
    render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={[blank]} questionTitles={new Map([[blank.id, "First step"]])} editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} /></PreferencesProvider>);
    expect(screen.getByLabelText("Conversation messages")).toHaveTextContent("First step");
  });

  it("opens only the current chapter and uses episode titles for the default outline", () => {
    localStorage.setItem("atlas-locale", "en");
    const chapters = [
      { id: "chapter-one", conversationId: conversation.id, title: "First chapter", questionIds: ["conversation-message-q1"], order: 0, collapsed: true, source: "auto" as const, createdAt: 1, updatedAt: 1 },
      { id: "chapter-two", conversationId: conversation.id, title: "Second chapter", questionIds: ["conversation-message-q2"], order: 1, collapsed: true, source: "auto" as const, createdAt: 1, updatedAt: 1 },
    ];
    render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={messages} editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} chapters={chapters} selectedMessageId="q2" episodes={[{ id: "episode-two", chapterId: "chapter-two", conversationId: conversation.id, title: "A meaningful second step", questionIds: ["conversation-message-q2"], messageIds: ["q2", "a1"] }]} /></PreferencesProvider>);
    expect(screen.getByRole("button", { name: /First chapter/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Second chapter/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A meaningful second step")).toBeVisible();
    expect(screen.queryByText("First question")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Find chapters or questions" }), { target: { value: "First question" } });
    expect(screen.getByText("First question")).toBeVisible();
  });
});

it("bounds a long question list while searching all questions and keeping a distant selection accessible", async () => {
  localStorage.setItem("atlas-locale", "en");
  const long = Array.from({ length: 1000 }, (_, i) => ({ ...messages[0], id: `question-${i}`, messageIndex: i, content: `Unique question ${i}` }));
  const { container } = render(<PreferencesProvider><ConversationSidebar conversation={conversation} conversations={[conversation]} messages={long} selectedMessageId="question-999" editable={false} showingAll={false} onShowAll={vi.fn()} onSelectConversation={vi.fn()} onSelectMessage={vi.fn()} /></PreferencesProvider>);
  expect(container.querySelectorAll(".conversation-message-item")).toHaveLength(81);
  expect(screen.getByRole("button", { name: /Unique question 999/ })).toHaveAttribute("aria-current", "true");
  fireEvent.change(screen.getByRole("textbox", { name: "Find chapters or questions" }), { target: { value: "Unique question 500" } });
  await waitFor(() => expect(container.querySelectorAll(".conversation-message-item")).toHaveLength(1));
  expect(screen.getByRole("button", { name: /Unique question 500/ })).toBeVisible();
});
