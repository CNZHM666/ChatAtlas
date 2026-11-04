import { isDeletedProject } from "./project-deletion";
import { DEFAULT_CANVAS_ID, OVERVIEW_CANVAS_ID } from "../shared/constants";
import type { AtlasCanvas } from "../shared/types";
import { getDatabase } from "./db";

export async function ensureDefaultCanvas(name = "My ChatAtlas"): Promise<AtlasCanvas> {
  const db = await getDatabase();
  const existing = await db.get("canvases", DEFAULT_CANVAS_ID);
  if (existing) return existing;
  const now = Date.now();
  const canvas: AtlasCanvas = { id: DEFAULT_CANVAS_ID, name, title: name, type: "topic", origin: "user", userEdited: false, createdAt: now, updatedAt: now };
  await db.put("canvases", canvas);
  return canvas;
}

export async function ensureOverviewCanvas(): Promise<AtlasCanvas> {
  const db = await getDatabase();
  const existing = await db.get("canvases", OVERVIEW_CANVAS_ID);
  if (existing) return existing;
  const now = Date.now();
  const canvas: AtlasCanvas = { id: OVERVIEW_CANVAS_ID, name: "总览", title: "总览", type: "overview", origin: "user", userEdited: false, createdAt: now, updatedAt: now };
  await db.put("canvases", canvas);
  return canvas;
}

export async function listCanvases(): Promise<AtlasCanvas[]> {
  await ensureOverviewCanvas();
  const all = (await (await getDatabase()).getAllFromIndex("canvases", "by-updated")).reverse().filter(canvas => !isDeletedProject(canvas)).map((canvas) => ({
    ...canvas,
    title: canvas.title ?? canvas.name,
    type: canvas.id === OVERVIEW_CANVAS_ID ? "overview" as const : canvas.type ?? "topic" as const,
    origin: canvas.origin ?? "user" as const,
    userEdited: canvas.userEdited ?? false,
  }));
  return [...all.filter((canvas) => canvas.id === OVERVIEW_CANVAS_ID), ...all.filter((canvas) => canvas.id !== OVERVIEW_CANVAS_ID)];
}

export async function createCanvas(name: string): Promise<AtlasCanvas> {
  const now = Date.now();
  const canvas: AtlasCanvas = { id: crypto.randomUUID(), name, title: name, type: "topic", origin: "user", userEdited: false, createdAt: now, updatedAt: now };
  await (await getDatabase()).put("canvases", canvas);
  return canvas;
}

export async function renameCanvas(id: string, name: string): Promise<void> {
  const db = await getDatabase();
  const canvas = await db.get("canvases", id);
  if (!canvas) return;
  await db.put("canvases", { ...canvas, name, title: name, type: canvas.type ?? "topic", origin: canvas.origin ?? "user", userEdited: true, updatedAt: Date.now() });
}

/** A manual reading order belongs to this canvas and takes precedence over future AI proposals. */
export async function saveReadingPath(canvasId: string, cardIds: string[]): Promise<AtlasCanvas> {
  const db = await getDatabase();
  const tx = db.transaction(["canvases", "canvasMemberships", "knowledgeCards"], "readwrite");
  const canvas = await tx.objectStore("canvases").get(canvasId);
  if (!canvas) { void tx.done.catch(() => undefined); tx.abort(); throw new Error("Knowledge Space no longer exists."); }
  const memberships = await tx.objectStore("canvasMemberships").index("by-canvas").getAll(canvasId);
  const allowed = new Set<string>();
  for (const membership of memberships) {
    const card = await tx.objectStore("knowledgeCards").get(membership.cardId);
    if (card) allowed.add(card.id);
  }
  if (cardIds.length !== new Set(cardIds).size || cardIds.some((id) => !allowed.has(id))) {
    void tx.done.catch(() => undefined);
    tx.abort();
    throw new Error("The reading path contains a missing or duplicate knowledge card.");
  }
  const updated = { ...canvas, readingPathCardIds: [...cardIds], readingPathUserEdited: true, updatedAt: Date.now() };
  await tx.objectStore("canvases").put(updated);
  await tx.done;
  return updated;
}
