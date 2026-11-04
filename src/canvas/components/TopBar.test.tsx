import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences";
import { TopBar } from "./TopBar";

describe("top bar organization progress", () => {
  it("keeps the workbench header free of graph controls and global search", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    render(<PreferencesProvider><TopBar view="canvas" onNewCard={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} mode="browse" onModeChange={vi.fn()} onSettings={vi.fn()} allowEdit={false} /></PreferencesProvider>);
    expect(screen.queryByRole("button", { name: /搜索/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "返回阅读" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "浏览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" }).previousElementSibling).toHaveClass("topbar-generation-slot");
  });
  it("shows concise real progress and a cancel action", () => {
    localStorage.setItem("atlas-locale", "en");
    const onCancelOrganize = vi.fn();
    render(<PreferencesProvider><TopBar view="canvas" onNewCard={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} mode="browse" onModeChange={vi.fn()} onSettings={vi.fn()} organizeProgress={{ label: "Reading conversations", detail: "2 / 3 · 1 reused" }} onCancelOrganize={onCancelOrganize} /></PreferencesProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("Reading conversations");
    expect(screen.getByRole("status")).toHaveTextContent("2 / 3 · 1 reused");
    expect(screen.queryByRole("button", { name: "Conversation library" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel organizing" }));
    expect(onCancelOrganize).toHaveBeenCalledOnce();
  });
});
