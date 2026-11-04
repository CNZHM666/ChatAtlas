import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspacePaneResize } from "./WorkspacePaneResize";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("shares the preferred width across panels while protecting reading space on smaller desktops", () => {
  let available = 1400, resized = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ width: available } as DOMRect));
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resized = callback; } observe() {} disconnect() {} });
  const tree = (id: string) => <div className="focus-workspace"><WorkspacePaneResize key={id} enabled zh/></div>;
  const { container, rerender } = render(tree("record"));
  const root = container.firstElementChild as HTMLElement;
  fireEvent.keyDown(screen.getByRole("separator"), { key: "End" });
  expect(root.style.getPropertyValue("--workspace-pane-width")).toBe("720px");
  rerender(tree("source"));
  expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "720");
  available = 960;
  // The observer responds to workspace width, including its left navigation.
  act(() => resized());
  expect(root.style.getPropertyValue("--workspace-pane-width")).toBe("400px");
  expect(localStorage.getItem("atlas-workspace-pane-width")).toBe("720");
  available = 1400; act(() => resized());
  expect(root.style.getPropertyValue("--workspace-pane-width")).toBe("720px");
  fireEvent.doubleClick(screen.getByRole("separator"));
  expect(root.style.getPropertyValue("--workspace-pane-width")).toBe("532px");
  expect(localStorage.getItem("atlas-workspace-pane-width")).toBeNull();
});

it("drags from the left edge, handles cancellation, and releases selection when switching to an overlay", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1400 } as DOMRect);
  const tree = (enabled: boolean) => <div className="focus-workspace"><WorkspacePaneResize enabled={enabled} zh/></div>;
  const { container, rerender } = render(tree(true));
  const handle = screen.getByRole("separator"), root = container.firstElementChild as HTMLElement;
  fireEvent.pointerDown(handle, { button: 0, clientX: 800 });
  fireEvent.pointerMove(handle, { clientX: 700 });
  expect(root.style.getPropertyValue("--workspace-pane-width")).toBe("632px");
  expect(document.body.style.userSelect).toBe("none");
  fireEvent.pointerCancel(handle);
  expect(document.body.style.userSelect).toBe("");
  expect(localStorage.getItem("atlas-workspace-pane-width")).toBe("632");
  fireEvent.pointerDown(handle, { button: 0, clientX: 800 });
  rerender(tree(false));
  expect(screen.queryByRole("separator")).toBeNull();
  expect(document.body.style.cursor).toBe("");
  expect(root.style.getPropertyValue("--workspace-pane-width")).toBe("");
});

it("keeps keyboard resizing usable when browser preference storage is unavailable", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 1400 } as DOMRect);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<div className="focus-workspace"><WorkspacePaneResize enabled zh/></div>);
  const handle = screen.getByRole("separator");
  fireEvent.keyDown(handle, { key: "Home" });
  expect(handle).toHaveAttribute("aria-valuenow", "320");
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  expect(handle).toHaveAttribute("aria-valuenow", "320");
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle).toHaveAttribute("aria-valuenow", "336");
});
