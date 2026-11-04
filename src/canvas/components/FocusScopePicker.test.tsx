import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FocusScopePicker } from "./FocusScopePicker";
import { PreferencesProvider } from "../preferences";
import type { ComponentProps } from "react";
import { getDatabase } from "../../storage/db";
import type { Conversation } from "../../shared/types";

// The default scope follows size; these cases use large material, where "related discussions" is the default.
const LARGE_TAIL = `\n\n${"Background notes without the goal words. ".repeat(1000)}`;
const source: Conversation = { id: "picker-source", title: "Mixed discussion", platform: "chatgpt", url: "", messageCount: 4, updatedAt: 1 };
beforeEach(async () => {
  localStorage.setItem("atlas-locale", "en");
  const db = await getDatabase();
  for (const store of ["messages", "focusSessions", "conversationGraphs", "questionSnapshots"] as const) await db.clear(store);
  for (const [index, content] of ["Stability conditions?", "Negative real parts.", "NumPy arrays?", "Broadcasting shapes."].entries()) await db.put("messages", { id: `picker-${index}`, conversationId: source.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content: content + LARGE_TAIL, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 });
});
afterEach(cleanup);
const renderPicker = (props: ComponentProps<typeof FocusScopePicker>) => render(<PreferencesProvider><FocusScopePicker {...props} /></PreferencesProvider>);
describe("scope confirmation", () => {
  it("organizes small material in full by default, and only related parts once it is large", async () => {
    const db = await getDatabase(); await db.clear("messages");
    for (const [index, content] of ["Stability conditions?", "Negative real parts."].entries()) await db.put("messages", { id: `small-${index}`, conversationId: source.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content, preview: "", contentHash: `small-${index}`, createdAt: index + 1, updatedAt: index + 1 } as never);
    renderPicker({ goal: "Review stability", sources: [source], zh: false, onConfirm: vi.fn(), onBack: vi.fn() });
    await waitFor(() => expect(screen.getByRole("radio", { name: "All content" })).toBeChecked());
    expect(screen.queryByText(/characters/)).toBeNull();
  });
  it("defaults to matching discussions and lets the user deselect, add context and explicitly choose all", async () => {
    const confirm = vi.fn();
    renderPicker({ goal: "Review stability", sources: [source], zh: false, onConfirm: confirm, onBack: vi.fn() });
    const button = screen.getByRole("button", { name: "Generate preview" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Related discussions" })).toBeChecked();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Adjust discussions/ }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Browse other discussions" }));
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(button);
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "goal", blocks: [expect.objectContaining({ messageIds: ["picker-2", "picker-3"] })] }), "Review stability", "work");
    fireEvent.click(screen.getByRole("radio", { name: "All content" }));
    fireEvent.click(button);
    expect(confirm).toHaveBeenLastCalledWith({ kind: "all", sourceConversationIds: [source.id] }, "Review stability", "work");
  });
  it("requires manual selection when the goal has no match and never falls back to all", async () => {
    const confirm = vi.fn();
    renderPicker({ goal: "Review thermodynamics", sources: [source], zh: false, onConfirm: confirm, onBack: vi.fn() });
    const button = screen.getByRole("button", { name: "Generate preview" });
    expect(button).toBeDisabled();
    expect(await screen.findByText(/No clear match/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search discussions" }), { target: { value: "NumPy" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(button);
    expect(confirm.mock.calls[0][0].kind).toBe("goal");
  });
  it("restores a manually confirmed scope without selecting new recommendations", async () => {
    const initialScope = { kind: "goal" as const, blocks: [{ conversationId: source.id, title: "Arrays", messageIds: ["picker-2", "picker-3"], messageSignatures: {} }] };
    renderPicker({ goal: "Review stability", sources: [source], initialScope, zh: false, onConfirm: vi.fn(), onBack: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: /^Adjust discussions/ }));
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(2));
    expect(screen.getAllByRole("checkbox")[0]).not.toBeChecked();
    expect(screen.getAllByRole("checkbox")[1]).toBeChecked();
  });
  it("keeps the goal editable and rematches before generating with the new goal and mode", async () => {
    const confirm = vi.fn();
    renderPicker({ goal: "Review stability", sources: [source], zh: false, onConfirm: confirm, onBack: vi.fn() });
    const button = screen.getByRole("button", { name: "Generate preview" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox", { name: "Today's goal" }), { target: { value: "Review NumPy" } });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ kind: "goal", blocks: [expect.objectContaining({ messageIds: ["picker-2", "picker-3"] })] }), "Review NumPy", "work");
  });
});
