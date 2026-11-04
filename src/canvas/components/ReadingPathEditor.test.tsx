import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasCard } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { ReadingPathEditor } from "./ReadingPathEditor";

afterEach(cleanup);

const card = (id: string, title: string): CanvasCard => ({ id, canvasId: "path-canvas", kind: "concept", title, x: 0, y: 0, tags: [], anchorIds: [], conversationIds: [], createdAt: 1, updatedAt: 1 });

describe("ReadingPathEditor", () => {
  it("lets the user reorder the current review path before saving", async () => {
    localStorage.setItem("atlas-locale", "zh-CN");
    const onSave = vi.fn(async () => undefined);
    render(<PreferencesProvider><ReadingPathEditor cards={[card("a", "状态空间"), card("b", "系统极点")]} initialPath={["a", "b"]} onClose={vi.fn()} onSave={onSave} /></PreferencesProvider>);
    fireEvent.click(screen.getByRole("button", { name: "上移 系统极点" }));
    fireEvent.click(screen.getByRole("button", { name: "保存路线" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["b", "a"]));
  });
});
