import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../../shared/types";
import { getAISettings } from "../../storage/knowledge-graph";
import { saveConversationCapture } from "../../storage/messages";
import { PreferencesProvider } from "../preferences";
import { KnowledgeSpaceCreate } from "./KnowledgeSpaceCreate";

vi.mock("../../storage/knowledge-graph", () => ({ getAISettings: vi.fn() }));

const conversation = (id: string, title = `Source ${id}`): Conversation => ({ id, title, platform: "chatgpt", url: `https://chatgpt.com/c/${id}`, messageCount: 2, importState: "complete", updatedAt: Number(id.replace(/\D/g, "")) || 1 });
const renderCreate = (conversations: Conversation[], props: Partial<React.ComponentProps<typeof KnowledgeSpaceCreate>> = {}) => {
  const onConfirm = vi.fn();
  render(<PreferencesProvider><KnowledgeSpaceCreate conversations={conversations} onClose={vi.fn()} onConfirm={onConfirm} {...props} /></PreferencesProvider>);
  return onConfirm;
};

beforeEach(() => {
  localStorage.setItem("atlas-locale", "en");
  vi.mocked(getAISettings).mockResolvedValue({ id: "ai-settings", provider: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiKey: "test-key", model: "test-model", updatedAt: 1 });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Knowledge Space source selection", () => {
  it("preserves selected sources and opens personal API setup without a hosted fallback", async () => {
    vi.mocked(getAISettings).mockResolvedValue(undefined);
    const onConfigureAI = vi.fn();
    const onConfirm = renderCreate([conversation("a")], { initialIntent: "Review control", initialConversationIds: ["a"], onConfigureAI });
    const submit = await screen.findByRole("button", { name: "Create and analyze 1 conversation" });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.getByRole("button", { name: "AI settings" })).toHaveTextContent("Connect AI");
    expect(screen.queryByText("ChatAtlas AI")).not.toBeInTheDocument();
    fireEvent.click(submit);
    expect(onConfigureAI).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Source a" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Review goal" })).toHaveValue("Review control");
  });
  it("recommends a conversation from its discussion even when the title is unrelated", async () => {
    const opaque = conversation("goal-evidence", "Untitled chat");
    await saveConversationCapture({ conversation: opaque, messages: [{ id: "goal-evidence-message", conversationId: opaque.id, messageIndex: 0, role: "user", content: "How do eigenvalues determine poles and stability?", preview: "Eigenvalues and poles", contentHash: "goal-evidence-hash", createdAt: 1, updatedAt: 1 }], capturedAt: 1 });
    const onConfirm = renderCreate([conversation("other", "Weekend plans"), opaque]);
    fireEvent.change(screen.getByRole("textbox", { name: "Review goal" }), { target: { value: "poles stability" } });
    expect(screen.getByRole("textbox", { name: "Knowledge Space name" })).toHaveValue("poles stability");
    await waitFor(() => expect(screen.getByText(/How do eigenvalues determine poles and stability/)).toBeVisible(), { timeout: 3000 });
    fireEvent.click(screen.getByRole("checkbox", { name: "Untitled chat" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create and analyze 1 conversation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create and analyze 1 conversation" }));
    expect(onConfirm).toHaveBeenCalledWith("poles stability", [opaque.id], "test-model", "poles stability");
  });
  it("finds imported titles and analyzes only sources chosen at Create", async () => {
    const sources = [conversation("python", "Python control library"), conversation("control", "Control theory"), conversation("math", "Linear algebra")];
    const onConfirm = renderCreate(sources);
    fireEvent.change(screen.getByRole("textbox", { name: "Knowledge Space name" }), { target: { value: "Control theory" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation titles" }), { target: { value: "control" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Python control library" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Control theory" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "AI settings" })).toHaveTextContent("test-model"));
    fireEvent.click(screen.getByRole("button", { name: "Create and analyze 2 conversations" }));
    expect(onConfirm).toHaveBeenCalledWith("Control theory", ["python", "control"], "test-model", "Control theory");
  });

  it("keeps selections while searching additional titles and supports all matching results", async () => {
    const sources = [conversation("a", "Control systems"), conversation("b", "Python control"), conversation("c", "Linear algebra")];
    const onConfirm = renderCreate(sources);
    fireEvent.change(screen.getByRole("textbox", { name: "Knowledge Space name" }), { target: { value: "Control" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation titles" }), { target: { value: "control" } });
    fireEvent.click(screen.getByRole("button", { name: "Select all results" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation titles" }), { target: { value: "algebra" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Linear algebra" }));
    expect(screen.getByText("3 selected")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create and analyze 3 conversations" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create and analyze 3 conversations" }));
    expect(new Set(onConfirm.mock.calls[0][1])).toEqual(new Set(["a", "b", "c"]));
  });

  it("searches all imported titles without rendering every conversation", () => {
    const sources = Array.from({ length: 1200 }, (_, index) => conversation(String(index), index === 1199 ? "Rare control topic" : `Other chat ${index}`));
    renderCreate(sources);
    expect(screen.getAllByRole("checkbox")).toHaveLength(80);
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation titles" }), { target: { value: "rare control" } });
    expect(screen.getByRole("checkbox", { name: "Rare control topic" })).toBeVisible();
  });

  it("preserves entry selections and excludes unavailable sources", async () => {
    const incomplete = { ...conversation("b"), importState: "discovered" as const };
    const onConfirm = renderCreate([conversation("a"), incomplete, conversation("c")], { initialIntent: "Control", initialConversationIds: ["a", "b"], excludedConversationIds: new Set(["c"]) });
    expect(screen.getByRole("checkbox", { name: "Source a" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Source b" })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: "Source c" })).not.toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Create and analyze 1 conversation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create and analyze 1 conversation" }));
    expect(onConfirm).toHaveBeenCalledWith("Control", ["a"], "test-model", "Control");
  });

  it("clears all chosen materials even when the current search hides most of them", () => {
    const sources = Array.from({ length: 30 }, (_, index) => conversation(String(index), index === 0 ? "Visible target" : `Other ${index}`));
    renderCreate(sources, { initialConversationIds: sources.map((item) => item.id) });
    fireEvent.change(screen.getByRole("textbox", { name: "Search conversation titles" }), { target: { value: "Visible target" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear all 30 selected" }));
    expect(screen.getByRole("checkbox", { name: "Visible target" })).not.toBeChecked();
    expect(screen.getByText("0 selected")).toBeVisible();
  });

  it("keeps ready sources visible and usable while most conversations are still syncing", async () => {
    const pending = Array.from({ length: 100 }, (_, index) => ({ ...conversation(`pending-${index}`, `Pending ${index}`), importState: "discovered" as const, sourceUpdatedAt: index + 100 }));
    const onConfirm = renderCreate([...pending, conversation("ready", "Control systems")]);
    expect(screen.getByText("1 ready · 100 pending")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Control systems" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Knowledge Space name" }), { target: { value: "Control" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Control systems" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create and analyze 1 conversation" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Create and analyze 1 conversation" }));
    expect(onConfirm.mock.calls[0][1]).toEqual(["ready"]);
  });

  it("shows the configured model without searching conversations through AI", async () => {
    const onConfigureAI = vi.fn();
    renderCreate([conversation("a")], { onConfigureAI });
    expect(await screen.findByRole("button", { name: "AI settings" })).toHaveTextContent("test-model");
    fireEvent.click(screen.getByRole("button", { name: "AI settings" }));
    expect(onConfigureAI).toHaveBeenCalledOnce();
    await waitFor(() => expect(getAISettings).toHaveBeenCalledOnce());
  });

});
