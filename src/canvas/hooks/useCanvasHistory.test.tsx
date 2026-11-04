import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CANVAS_ID } from "../../shared/constants";
import { getDatabase } from "../../storage/db";
import { useCanvasHistory } from "./useCanvasHistory";
import * as cardsRepository from "../../storage/cards";
import * as edgesRepository from "../../storage/edges";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("first-run canvas", () => {
  it("defers graph reads until needed and never rewrites an unchanged loaded graph", async () => {
    const listCards = vi.spyOn(cardsRepository, "listCards").mockResolvedValue([]);
    const listEdges = vi.spyOn(edgesRepository, "listEdges").mockResolvedValue([]);
    const saveCards = vi.spyOn(cardsRepository, "saveCards").mockResolvedValue();
    const saveEdges = vi.spyOn(edgesRepository, "saveEdges").mockResolvedValue();
    const { result, rerender } = renderHook(({ enabled }) => useCanvasHistory(DEFAULT_CANVAS_ID, enabled), { initialProps: { enabled: false } });
    expect(listCards).not.toHaveBeenCalled();
    expect(listEdges).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(saveCards).not.toHaveBeenCalled();
    expect(saveEdges).not.toHaveBeenCalled();
    act(() => result.current.mutate((current) => ({ ...current, cards: [...current.cards] })));
    await waitFor(() => expect(saveCards).toHaveBeenCalledOnce());
    expect(saveEdges).toHaveBeenCalledOnce();
    rerender({ enabled: false }); rerender({ enabled: true });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(listCards).toHaveBeenCalledTimes(2);
  });
  it("does not create demo cards or edges in a fresh local database", async () => {
    const { result } = renderHook(() => useCanvasHistory(DEFAULT_CANVAS_ID));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.cards).toEqual([]);
    expect(result.current.edges).toEqual([]);
    expect(await (await getDatabase()).count("cards")).toBe(0);
  });
});
