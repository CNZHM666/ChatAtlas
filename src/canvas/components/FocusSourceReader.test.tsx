import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { getDatabase } from "../../storage/db";
import type { Conversation, ConversationGraph, ConversationMessage } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
import { PreferencesProvider } from "../preferences";
import { loadConversationGraph, saveConversationGraph } from "../conversation-graph";
import { OriginalReader } from "./OriginalReader";
import { FocusSourceReader } from "./FocusSourceReader";

afterEach(cleanup);

it("shows a saved excerpt when a source has no local body and rereads after hydration", async () => {
  localStorage.setItem("atlas-locale", "zh-CN");
  const conversation: Conversation = { id: "empty-source-note", title: "历史对话", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 };
  const session: FocusSession = { id: "excerpt-project", title: "Project", goal: "Plan", mode: "work", sourceConversationIds: [conversation.id], sections: [], evidence: [{ id: "e1", conversationId: conversation.id, messageId: "platform-answer", title: conversation.title, excerpt: "保存过的验证条件" }], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
  const view = render(<PreferencesProvider><FocusSourceReader conversation={conversation} session={session} zh targetMessageId="platform-answer" onBack={vi.fn()} /></PreferencesProvider>);
  expect(await screen.findByText("保存过的验证条件")).toBeVisible();
  expect(screen.getByRole("heading", { name: "已保存的原文摘录" })).toBeVisible();
  const messages: ConversationMessage[] = ["同步的原问题", "同步的完整答案"].map((content, index) => ({ id: `hydrated-note-${index}`, platformMessageId: index ? "platform-answer" : "platform-question", conversationId: conversation.id, messageIndex: index, role: index ? "assistant" : "user", content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 }));
  const db = await getDatabase();
  for (const message of messages) await db.put("messages", message);
  fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(view.container.querySelector(".knowledge-reader-message.is-focused")).toHaveTextContent("同步的完整答案"));
  expect(screen.queryByRole("heading", { name: "已保存的原文摘录" })).not.toBeInTheDocument();
});

it("shares question navigation between the library and project source while retaining saved chapters", async () => {
  localStorage.setItem("atlas-locale", "en");
  const conversation: Conversation = { id: "unified-source", title: "Planning", platform: "chatgpt", url: "", messageCount: 4, updatedAt: 1 };
  const messages: ConversationMessage[] = ["First question", "First answer", "Next question", "Distinctive condition"].map((content, index) => ({ id: `unified-${index}`, conversationId: conversation.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 }));
  const graph: ConversationGraph = { conversationId: conversation.id, nodes: [], edges: [], updatedAt: 1, chapters: [{ id: "saved-chapter", conversationId: conversation.id, title: "Saved outline", order: 0, questionIds: ["conversation-message-unified-0", "conversation-message-unified-2"], source: "user", collapsed: false, createdAt: 1, updatedAt: 1 }] };
  await saveConversationGraph(graph);
  const storedGraph = await loadConversationGraph(conversation.id);
  const db = await getDatabase();
  for (const message of messages) await db.put("messages", message);
  const session: FocusSession = { id: "unified-project", title: "Project", goal: "Plan", mode: "work", sourceConversationIds: [conversation.id], sections: [], evidence: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
  const library = render(<PreferencesProvider><OriginalReader conversation={conversation} messages={messages} loading={false} reviews={[session]} onBack={vi.fn()} /></PreferencesProvider>);
  const libraryOutline = library.container.querySelector(".conversation-sidebar")!;
  await waitFor(() => expect(libraryOutline.querySelector(".conversation-question-count")).toHaveTextContent("2"));
  const questionLabels = [...libraryOutline.querySelectorAll(".conversation-message-item")].map(item => item.textContent);
  expect(libraryOutline.querySelector(".conversation-outline-intro p")).toBeNull();
  expect(libraryOutline.querySelector(".conversation-question-count")).toHaveTextContent("2");
  expect(libraryOutline.querySelector(".conversation-chapter-navigation")).toBeNull();
  library.unmount();
  const back = vi.fn();
  const project = render(<PreferencesProvider><FocusSourceReader conversation={conversation} session={session} zh={false} onBack={back} /></PreferencesProvider>);
  await screen.findByRole("button", { name: "02 Next question" });
  expect([...project.container.querySelectorAll(".conversation-message-item")].map(item => item.textContent)).toEqual(questionLabels);
  expect(project.container.querySelector(".reader-conversation")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Understanding path" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search questions or answers" }), { target: { value: "Distinctive condition" } });
  await waitFor(() => expect(project.container.querySelectorAll(".conversation-message-item")).toHaveLength(1));
  expect(project.container.querySelector(".conversation-question-count")).toHaveTextContent("1");
  // Found in the answer, so the line it was found in is shown under the question.
  expect(project.container.querySelector(".message-search-snippet")).toHaveTextContent("In the answer: Distinctive condition");
  fireEvent.click(screen.getByRole("button", { name: /^02 Next question/u }));
  await waitFor(() => expect(project.container.querySelector(".knowledge-reader-message.is-focused")).toHaveTextContent("Next question"));
  fireEvent.click(screen.getByRole("button", { name: "Back to reading" }));
  expect(back).toHaveBeenCalledOnce();
  expect(await loadConversationGraph(conversation.id)).toEqual(storedGraph);
});
