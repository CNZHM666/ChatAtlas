import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeSpaceUiState } from "../atlas-status";
import { PreferencesProvider } from "../preferences";
import { KnowledgeOverview } from "./KnowledgeOverview";

vi.mock("../../storage/knowledge-graph", () => ({
  getKnowledgeOverview: vi.fn().mockResolvedValue({ domains: [], links: [] }),
}));

const idle: KnowledgeSpaceUiState = {
  phase: "demo_idle",
  sync: { state: "idle", completed: 0, discovered: 0, failed: 0 },
  domainCount: 0,
  proposalDomainCount: 0,
};

const handlers = {
  onSelect: vi.fn(), onStartSync: vi.fn(),
  onStartCreate: vi.fn(),
  onRetrySync: vi.fn(), onReconnect: vi.fn(), onViewDetails: vi.fn(),
};

beforeEach(() => {
  localStorage.setItem("atlas-locale", "en");
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("Knowledge Space Overview interaction", () => {
  it("opens a demo relation focus, switches directly, and restores the import action", () => {
    render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={idle} {...handlers} /></PreferencesProvider>);
    const importAction = screen.getByRole("button", { name: "Import AI conversation file" });
    expect(importAction).toBeVisible();
    expect(screen.getByText("Knowledge Space")).toBeVisible();
    expect(screen.getByText("Control").closest("button")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "Automation" }));
    expect(importAction).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Control" })).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("Design").closest("button")).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(screen.getByRole("button", { name: "Programming" }));
    expect(screen.getByRole("button", { name: "Programming" })).toHaveClass("is-focus-node");
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByRole("button", { name: "Import AI conversation file" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Import from AI websites" })).toBeVisible();
    expect(screen.getByText("Control").closest("button")).toHaveAttribute("tabindex", "-1");
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("keeps both import actions side by side and opens a detailed file guide", () => {
    const { container } = render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={idle} {...handlers} /></PreferencesProvider>);
    const actions = container.querySelector(".knowledge-import-actions");
    expect(actions).toContainElement(screen.getByRole("button", { name: "Import AI conversation file" }));
    expect(actions).toContainElement(screen.getByRole("button", { name: "Import from AI websites" }));
    expect(screen.queryByText(/Import an official ChatGPT export for large history/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How to import a ChatGPT export" }));
    expect(screen.getByRole("dialog", { name: "Import your ChatGPT data" })).toBeVisible();
    expect(screen.getByText("Request an export in ChatGPT")).toBeVisible();
    expect(screen.getByText("Choose the file in ChatAtlas")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open OpenAI's official export instructions" })).toHaveAttribute("href", "https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not show a bottom status card while the first sync is running", () => {
    const syncing: KnowledgeSpaceUiState = {
      ...idle,
      phase: "demo_syncing",
      sync: { state: "syncing", completed: 0, discovered: 10, failed: 0 },
    };
    const { container } = render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={syncing} {...handlers} /></PreferencesProvider>);
    expect(container.querySelector(".knowledge-state")).not.toBeInTheDocument();
    expect(screen.queryByText("Syncing your conversations")).not.toBeInTheDocument();
    expect(screen.getByText("0 / 10")).toBeVisible();
    expect(screen.getAllByRole("progressbar")).toHaveLength(1);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.queryByRole("button", { name: "Create Knowledge Space →" })).not.toBeInTheDocument();
    expect(container.querySelectorAll(".knowledge-onboarding-state")).toHaveLength(1);
  });

  it("does not show a sync-success card or the retired organize action", () => {
    const synced: KnowledgeSpaceUiState = { ...idle, phase: "demo_synced_ready", sync: { state: "synced", completed: 127, discovered: 127, failed: 0 } };
    const { container } = render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={synced} {...handlers} /></PreferencesProvider>);
    expect(container.querySelector(".knowledge-state")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organize" })).not.toBeInTheDocument();
    expect(screen.getByText("127 ready")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create Knowledge Space →" }));
    expect(handlers.onStartCreate).toHaveBeenCalledOnce();
  });

  it("restores hover emphasis on the compact orb without opening a focus view during onboarding", () => {
    const synced: KnowledgeSpaceUiState = { ...idle, phase: "demo_synced_ready", sync: { state: "synced", completed: 127, discovered: 127, failed: 0 } };
    const { container } = render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={synced} {...handlers} /></PreferencesProvider>);
    const word = screen.getByText("Automation").closest("button")!;
    fireEvent.mouseEnter(word);
    expect(container.querySelector(".orb-node.is-muted")).toBeInTheDocument();
    expect(container.querySelector(".orb-links line[style*='0.4']")).toBeInTheDocument();
    fireEvent.click(word);
    expect(screen.getByRole("button", { name: "Create Knowledge Space →" })).toBeVisible();
  });

  it("removes the bottom retry card after a partial sync", () => {
    const partial: KnowledgeSpaceUiState = { ...idle, phase: "demo_partial_ready", sync: { state: "partial", completed: 125, discovered: 127, failed: 2 } };
    const { container } = render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={partial} {...handlers} /></PreferencesProvider>);
    expect(container.querySelector(".knowledge-state")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organize" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry 2" })).not.toBeInTheDocument();
    expect(screen.getByText("125 ready")).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("does not restore the bottom card when a retry needs authentication but data exists", () => {
    const auth: KnowledgeSpaceUiState = { ...idle, phase: "auth_required", sync: { state: "auth_required", completed: 125, discovered: 127, failed: 2 } };
    const { container } = render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={auth} {...handlers} /></PreferencesProvider>);
    expect(container.querySelector(".knowledge-state")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Organize" })).not.toBeInTheDocument();
  });

  it("lets the user create during a retry while showing compact progress", () => {
    const retrying: KnowledgeSpaceUiState = { ...idle, phase: "demo_synced_ready", sync: { state: "syncing", completed: 125, discovered: 127, failed: 2 } };
    const { container } = render(<PreferencesProvider><KnowledgeOverview canvases={[]} proposal={null} uiState={retrying} {...handlers} /></PreferencesProvider>);
    expect(container.querySelector(".knowledge-state")).not.toBeInTheDocument();
    expect(screen.queryByText("Syncing your conversations")).not.toBeInTheDocument();
    expect(screen.getByText("125 ready")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "125");
    expect(container.querySelectorAll(".knowledge-onboarding-state")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Create Knowledge Space →" }));
    expect(handlers.onStartCreate).toHaveBeenCalledOnce();
  });
});
