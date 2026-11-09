import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences";
import { MapSidebar } from "./MapSidebar";
afterEach(cleanup);

it("requires confirmation before emptying Trash and allows canceling without removing anything", async () => {
  localStorage.setItem("atlas-locale", "zh-CN");
  const empty = vi.fn().mockResolvedValue(undefined), restore = vi.fn();
  render(<PreferencesProvider><MapSidebar canvases={[]} activeId="" onSelect={vi.fn()} onRename={vi.fn()} deletedProjects={[{ id: "deleted", title: "旧项目", name: "旧项目", createdAt: 1, updatedAt: 1 }]} onRestore={restore} onEmptyTrash={empty} /></PreferencesProvider>);
  fireEvent.click(screen.getByText("回收站 · 1"));
  // The clear action is on the 回收站 row; it opens the list to ask before anything is deleted.
  expect(screen.getByRole("button", { name: "清空回收站" }).closest("summary")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
  expect(empty).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByRole("button", { name: "恢复项目 旧项目" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
  fireEvent.click(screen.getByRole("button", { name: "永久清空" }));
  await waitFor(() => expect(empty).toHaveBeenCalledOnce());
  expect(restore).not.toHaveBeenCalled();
});

it("shows 清空回收站 on the 回收站 row again once the list is closed while asking", () => {
  localStorage.setItem("atlas-locale", "zh-CN");
  render(<PreferencesProvider><MapSidebar canvases={[]} activeId="" onSelect={vi.fn()} onRename={vi.fn()} deletedProjects={[{ id: "deleted", title: "旧项目", name: "旧项目", createdAt: 1, updatedAt: 1 }]} onRestore={vi.fn()} onEmptyTrash={vi.fn().mockResolvedValue(undefined)} /></PreferencesProvider>);
  // Closed: the action is on the row.
  expect(screen.getByRole("button", { name: "清空回收站", hidden: true })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清空回收站", hidden: true }));
  expect(screen.queryByRole("button", { name: "清空回收站", hidden: true })).toBeNull();
  // Closed without answering: the question is dropped and the action is back on the row.
  const details = document.querySelector("details.project-trash") as HTMLDetailsElement;
  details.open = false;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByRole("button", { name: "清空回收站", hidden: true }).closest("summary")).not.toBeNull();
});
