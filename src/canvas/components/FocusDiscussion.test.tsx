import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FocusDiscussion } from "./FocusDiscussion";
import { readerMessages } from "../reader-message-cache";
import { getStoredConversationGraph } from "../../storage/conversation-graphs";
import type { ConversationMessage } from "../../shared/types";
vi.mock("../reader-message-cache", () => ({ readerMessages: vi.fn(), invalidateReaderMessages: vi.fn() }));
vi.mock("../../storage/conversation-graphs", () => ({ getStoredConversationGraph: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps the saved excerpt visible when conversation metadata and local messages are missing", async () => {
  vi.mocked(readerMessages).mockResolvedValue([]);
  vi.mocked(getStoredConversationGraph).mockResolvedValue(undefined);
  render(<FocusDiscussion evidence={[{ id: "old-ref", conversationId: "removed", messageId: "old", title: "原讨论", excerpt: "保留的原始条件" }]} zh />);
  expect(await screen.findByText("保留的原始条件")).toBeVisible();
  expect(screen.getByRole("button", { name: "重新读取" })).toBeVisible();
});
it("restores the actual question when an old contextual episode contains only the cited answer", async () => {
  const messages: ConversationMessage[] = ["Earlier question", "Earlier answer", "Actual question", "Answer opening", "Cited finding"].map((content, i) => ({ id: `m${i}`, conversationId: "c", messageIndex: i, role: i === 0 || i === 2 ? "user" : "assistant", content, preview: content, contentHash: content, createdAt: 1, updatedAt: 1 }));
  vi.mocked(readerMessages).mockResolvedValue(messages);
  vi.mocked(getStoredConversationGraph).mockResolvedValue({ conversationId: "c", nodes: [], edges: [], updatedAt: 1, episodes: [{ id: "old", chapterId: "chapter", conversationId: "c", title: "Old context", questionIds: [], messageIds: ["m4"] }] });
  const landings: HTMLElement[] = [], original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = vi.fn(function(this: HTMLElement) { landings.push(this); });
  try {
    const { container } = render(<FocusDiscussion evidence={[{ id: "ref", conversationId: "c", messageId: "m4", title: "Discussion", excerpt: "Cited finding" }]} focusMessageId="m4" focusExcerpt="Cited finding" zh={false} />);
    await screen.findByText("Actual question");
    await waitFor(() => expect(landings).toHaveLength(1));
    expect(landings[0].dataset.readerMessageId).toBe("m2");
    expect(container.querySelector(".reader-evidence-target")?.textContent).toBe("Cited finding");
    expect(screen.getByText("Answer opening")).toBeInTheDocument();
  } finally { HTMLElement.prototype.scrollIntoView = original; }
});
