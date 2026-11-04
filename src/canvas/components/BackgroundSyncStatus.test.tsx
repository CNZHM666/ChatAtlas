import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportJob } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { BackgroundSyncStatus } from "./BackgroundSyncStatus";

const job = { status: "syncing", retryScope: "selected", pendingIds: ["pending-one", "pending-two"], discovered: 132, completed: 1 } as ImportJob;
afterEach(cleanup);
describe("background sync controls", () => {
  it("keeps pause and resume available outside the Workbench", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const props = { job, source: "web" as const, onPause: vi.fn(), onResume: vi.fn(), onConnect: vi.fn() };
    const { rerender } = render(<PreferencesProvider><BackgroundSyncStatus {...props} /></PreferencesProvider>);
    expect(screen.getByRole("status")).toHaveTextContent("后台同步剩余 2 条");
    fireEvent.click(screen.getByRole("button", { name: /后台同步/ }));
    fireEvent.click(screen.getByRole("button", { name: "暂停同步" }));
    expect(props.onPause).toHaveBeenCalledOnce();
    rerender(<PreferencesProvider><BackgroundSyncStatus {...props} job={{ ...job, status: "paused" }} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: /同步已暂停/ }));
    fireEvent.click(screen.getByRole("button", { name: "继续同步" }));
    expect(props.onResume).toHaveBeenCalledOnce();
    rerender(<PreferencesProvider><BackgroundSyncStatus {...props} job={{ ...job, status: "inventory_ready" }} /></PreferencesProvider>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("offers connection recovery without marking an auth failure as active", () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const onConnect = vi.fn();
    const { container } = render(<PreferencesProvider><BackgroundSyncStatus job={{ ...job, status: "auth_required" }} source="web" onPause={vi.fn()} onResume={vi.fn()} onConnect={onConnect} /></PreferencesProvider>);
    expect(container.querySelector(".sync-state-dot.is-active")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /同步需连接/ }));
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    expect(onConnect).toHaveBeenCalledOnce();
  });
});
