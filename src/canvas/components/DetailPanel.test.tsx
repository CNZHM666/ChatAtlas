import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasCard, Conversation, MessageAnchor } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { DetailPanel } from "./DetailPanel";

const topic: CanvasCard = { id: "topic-1", canvasId: "map-1", kind: "topic", title: "State machines", notes: "First note", x: 0, y: 0, tags: [], anchorIds: [], conversationIds: [], createdAt: 1, updatedAt: 1 };

afterEach(cleanup);

describe("topic detail panel", () => {
  it("presents a manually created card as one editable content field", () => {
    localStorage.setItem("atlas-locale", "en");
    const personal: CanvasCard = { ...topic, kind: "concept", origin: "user", description: "One thought", notes: "One thought" };
    const { container } = render(<PreferencesProvider><DetailPanel card={personal} anchors={[]} conversations={[]} editMode={true} onClose={vi.fn()} onOpenConversation={vi.fn()} onAddSource={vi.fn()} onNotesChange={vi.fn()} onNotesBlur={vi.fn()} onAnchor={vi.fn()} /></PreferencesProvider>);
    expect(container.querySelector(".panel-description")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Content" })).toHaveValue("One thought");
    expect(screen.queryByRole("heading", { name: "My notes" })).not.toBeInTheDocument();
  });
  it("starts with readable notes, then edits on demand", () => {
    localStorage.setItem("atlas-locale", "en");
    const onNotesChange = vi.fn();
    const onNotesBlur = vi.fn();
    render(<PreferencesProvider><DetailPanel card={topic} anchors={[]} conversations={[]} editMode={false} onClose={vi.fn()} onOpenConversation={vi.fn()} onAddSource={vi.fn()} onNotesChange={onNotesChange} onNotesBlur={onNotesBlur} onAnchor={vi.fn()} /></PreferencesProvider>);
    expect(screen.queryByRole("textbox", { name: "My notes" })).not.toBeInTheDocument();
    expect(screen.getByText("First note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit note" }));
    const notes = screen.getByRole("textbox", { name: "My notes" });
    expect(notes).toHaveValue("First note");
    fireEvent.change(notes, { target: { value: "Updated note" } });
    fireEvent.blur(notes);
    expect(onNotesChange).toHaveBeenCalledWith("Updated note");
    expect(onNotesBlur).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Sources · 0" })).toBeInTheDocument();
  });

  it("groups quoted messages under their source conversation with distinct navigation", () => {
    localStorage.setItem("atlas-locale", "en");
    const conversation: Conversation = { id: "c-1", platform: "chatgpt", title: "Source conversation", url: "https://chatgpt.com/c/c-1", updatedAt: 1, messageCount: 1 };
    const anchor: MessageAnchor = { id: "a-1", conversationId: "c-1", conversationUrl: conversation.url, messageId: "m-1", role: "user", contentHash: "hash", preview: "Quoted thought", createdAt: 1 };
    const onOpenConversation = vi.fn();
    const onAnchor = vi.fn();
    render(<PreferencesProvider><DetailPanel card={topic} anchors={[anchor]} conversations={[conversation]} editMode={false} onClose={vi.fn()} onOpenConversation={onOpenConversation} onAddSource={vi.fn()} onNotesChange={vi.fn()} onNotesBlur={vi.fn()} onAnchor={onAnchor} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: /Source conversation/ }));
    expect(onOpenConversation).toHaveBeenCalledWith("c-1");
    fireEvent.click(screen.getByRole("button", { name: /Quoted thought/ }));
    expect(onAnchor).toHaveBeenCalledWith(anchor);
  });
});
