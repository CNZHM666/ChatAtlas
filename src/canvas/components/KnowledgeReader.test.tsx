import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasCard, Conversation, ConversationMessage } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { KnowledgeReader } from "./KnowledgeReader";

const getMessagesForConversation = vi.hoisted(() => vi.fn());
const getReadingProgress = vi.hoisted(() => vi.fn());
const saveReadingProgress = vi.hoisted(() => vi.fn());
vi.mock("../../storage/messages", () => ({ getMessagesForConversation }));
vi.mock("../../storage/reading-progress", () => ({ getReadingProgress, saveReadingProgress }));

const knowledge: CanvasCard = {
  id: "k", canvasId: "space", kind: "concept", title: "System poles", description: "Review the meaning of poles.",
  x: 0, y: 0, tags: [], anchorIds: [], conversationIds: ["source"],
  evidenceRefs: [{ conversationId: "source", messageId: "m-8" }], createdAt: 1, updatedAt: 1,
};
const conversation: Conversation = { id: "source", platform: "chatgpt", title: "Control theory", url: "https://chatgpt.com/c/source", updatedAt: Date.UTC(2026, 0, 1), messageCount: 16 };
const messages: ConversationMessage[] = Array.from({ length: 16 }, (_, index) => ({
  id: `m-${index}`, conversationId: "source", messageIndex: index, role: index % 2 ? "assistant" : "user",
  content: `Turn ${index}`, preview: `Turn ${index}`, contentHash: `hash-${index}`, createdAt: 1, updatedAt: 1,
}));

describe("KnowledgeReader", () => {
  beforeEach(() => { cleanup(); localStorage.setItem("atlas-locale", "en"); getMessagesForConversation.mockReset().mockResolvedValue(messages); getReadingProgress.mockReset().mockResolvedValue(undefined); saveReadingProgress.mockReset().mockResolvedValue(undefined); });

  it("reads contiguous context in ChatAtlas without an external jump", async () => {
    const onSelectCard = vi.fn();
    const onClose = vi.fn();
    render(<PreferencesProvider><KnowledgeReader card={knowledge} conversations={[conversation]} anchors={[]} previous={[]} next={[{ ...knowledge, id: "next", title: "Stability" }]} onSelectCard={onSelectCard} onClose={onClose} /></PreferencesProvider>);
    expect(screen.getByRole("button", { name: "Back to Knowledge Space" })).toBeVisible();
    expect(screen.queryByText("Knowledge reader")).not.toBeInTheDocument();
    expect(await screen.findByText("Turn 8")).toBeInTheDocument();
    expect(screen.getByText("Turn 4")).toBeInTheDocument();
    expect(screen.queryByText("Turn 0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Read full conversation in ChatAtlas" }));
    expect(screen.getByText("Turn 0")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stability" }));
    expect(onSelectCard).toHaveBeenCalledWith("next");
    expect(screen.queryByRole("button", { name: "Verify in original app" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Knowledge Space" }));
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(getMessagesForConversation).toHaveBeenCalledTimes(1));
  });

  it("keeps an early source readable while restoring a target in a later source", async () => {
    let releaseLateSource: ((value: ConversationMessage[]) => void) | undefined;
    const lateMessages = messages.map((message) => ({ ...message, id: `late-${message.id}`, conversationId: "late-source", content: `Late ${message.content}` }));
    getMessagesForConversation.mockImplementation((id: string) => id === "late-source"
      ? new Promise<ConversationMessage[]>((resolve) => { releaseLateSource = resolve; })
      : Promise.resolve([{ ...messages[0], id: "early-message", conversationId: "early-source", content: "Early source is ready" }]));
    const card = { ...knowledge, id: "two-source-card", conversationIds: ["early-source", "late-source"], evidenceRefs: [{ conversationId: "early-source", messageId: "early-message" }, { conversationId: "late-source", messageId: "late-m-8" }] };
    const sources = [
      { ...conversation, id: "early-source", title: "Earlier discussion" },
      { ...conversation, id: "late-source", title: "Later discussion" },
    ];
    render(<PreferencesProvider><KnowledgeReader card={card} conversations={sources} anchors={[]} previous={[]} next={[]} initialMessageId="late-m-0" onSelectCard={vi.fn()} onClose={vi.fn()} /></PreferencesProvider>);
    expect(await screen.findByText("Early source is ready")).toBeInTheDocument();
    expect(screen.queryByText("Late Turn 0")).not.toBeInTheDocument();
    expect(releaseLateSource).toBeTypeOf("function");
    releaseLateSource?.(lateMessages);
    await screen.findByText("Late Turn 8");
    const lateSection = await screen.findByRole("region", { name: "Later discussion" });
    expect(await within(lateSection).findByRole("button", { name: "Show relevant discussion" })).toBeInTheDocument();
    expect(within(lateSection).getByText("Late Turn 0")).toBeInTheDocument();
  });

  it("opens an explicit answer citation at the user question, while a saved reading position stays exact", async () => {
    const landings: HTMLElement[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn(function(this: HTMLElement) { landings.push(this); });
    try {
      const props = { card: knowledge, conversations: [conversation], anchors: [], previous: [], next: [], onSelectCard: vi.fn(), onClose: vi.fn() };
      render(<PreferencesProvider><KnowledgeReader {...props} initialMessageId="m-9" /></PreferencesProvider>);
      await waitFor(() => expect(landings.some(element => element.dataset.readerMessageId === "m-8")).toBe(true));
      expect(landings.some(element => element.dataset.readerMessageId === "m-9")).toBe(false);
      cleanup();
      landings.length = 0;
      getReadingProgress.mockResolvedValue({ messageId: "m-9", scrollTop: 300 });
      render(<PreferencesProvider><KnowledgeReader {...props} /></PreferencesProvider>);
      await waitFor(() => expect(landings.length).toBeGreaterThan(0));
      expect(landings.at(-1)?.closest("[data-reader-message-id]")?.getAttribute("data-reader-message-id")).toBe("m-9");
    } finally { HTMLElement.prototype.scrollIntoView = original; }
  });
});
