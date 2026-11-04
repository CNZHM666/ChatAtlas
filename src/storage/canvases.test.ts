import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CanvasCard } from "../shared/types";
import { createCanvas, listCanvases, renameCanvas, saveReadingPath } from "./canvases";
import { listCards, saveCards } from "./cards";
import { listEdges, saveEdges } from "./edges";

const card = (id: string, canvasId: string): CanvasCard => ({
  id,
  canvasId,
  kind: "topic",
  title: id,
  x: 0,
  y: 0,
  tags: [],
  anchorIds: [],
  conversationIds: [],
  createdAt: 1,
  updatedAt: 1,
});

describe("multiple canvases", () => {
  it("creates and renames maps while isolating their cards", async () => {
    const first = await createCanvas("Research");
    const second = await createCanvas("Projects");
    await saveCards(first.id, [card("first-card", first.id)]);
    await saveCards(second.id, [card("second-card", second.id)]);
    await saveCards(first.id, []);
    await renameCanvas(second.id, "Active projects");

    expect(await listCards(first.id)).toEqual([]);
    expect((await listCards(second.id)).map((item) => item.id)).toEqual(["second-card"]);
    expect((await listCanvases()).some((canvas) => canvas.id === second.id && canvas.name === "Active projects")).toBe(true);
  });

  it("normalizes old demo counts and pre-relation edges without losing records", async () => {
    const canvas = await createCanvas("Legacy");
    await saveCards(canvas.id, [{ ...card("legacy-topic", canvas.id), conversationIds: ["legacy-topic-conversation-1", "real-source"] }]);
    await saveEdges(canvas.id, [{ id: "legacy-edge", canvasId: canvas.id, source: "legacy-topic", target: "other", type: "manual", createdAt: 1 }]);
    expect((await listCards(canvas.id))[0].conversationIds).toEqual(["real-source"]);
    expect((await listEdges(canvas.id))[0]).toMatchObject({ id: "legacy-edge", relation: "structural" });
  });

  it("persists topic notes with their card", async () => {
    const canvas = await createCanvas("Notes");
    await saveCards(canvas.id, [{ ...card("note-topic", canvas.id), notes: "Compare the two explanations tomorrow." }]);
    expect((await listCards(canvas.id))[0].notes).toBe("Compare the two explanations tomorrow.");
  });
  it("saves a user-owned reading order and rejects cards outside this space", async () => {
    const canvas = await createCanvas("Path");
    const another = await createCanvas("Other path");
    await saveCards(canvas.id, [card("first-path-card", canvas.id), card("second-path-card", canvas.id)]);
    await saveCards(another.id, [card("outside-path-card", another.id)]);
    const updated = await saveReadingPath(canvas.id, ["second-path-card", "first-path-card"]);
    expect(updated).toMatchObject({ readingPathCardIds: ["second-path-card", "first-path-card"], readingPathUserEdited: true });
    await expect(saveReadingPath(canvas.id, ["outside-path-card"])).rejects.toThrow("missing or duplicate");
    await expect(saveReadingPath(canvas.id, ["first-path-card", "first-path-card"])).rejects.toThrow("missing or duplicate");
    expect((await listCanvases()).find((item) => item.id === canvas.id)?.readingPathCardIds).toEqual(["second-path-card", "first-path-card"]);
  });
});
