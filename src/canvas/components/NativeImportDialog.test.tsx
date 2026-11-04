import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeImportDialog } from "./NativeImportDialog";
afterEach(cleanup);
it("imports exactly the platforms explicitly selected by the user", () => {
  const sources = [{ id: "claude", platform: "claude" as const, origin: "https://claude.ai", tabId: 1, label: "Claude" }, { id: "gemini", platform: "gemini" as const, origin: "https://gemini.google.com", tabId: 2, label: "Gemini" }];
  const choose = vi.fn(), close = vi.fn();
  render(<NativeImportDialog sources={sources} zh onChoose={choose} onClose={close}/>);
  expect(screen.getByRole("button", { name: "取消" })).toHaveClass("file-import-guide-cancel");
  expect(screen.getByRole("button", { name: "导入所选（0）" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: /Gemini/ }));
  fireEvent.click(screen.getByRole("button", { name: "导入所选（1）" }));
  expect(choose).toHaveBeenCalledExactlyOnceWith([sources[1]]);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(close).toHaveBeenCalledOnce();
});
