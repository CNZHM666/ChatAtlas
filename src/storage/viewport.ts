import type { CanvasViewport } from "../shared/types";
import { getDatabase } from "./db";

export async function loadCanvasViewport(canvasId: string): Promise<CanvasViewport | undefined> {
  return (await getDatabase()).get("viewports", `canvas:${canvasId}`);
}

export async function saveCanvasViewport(canvasId: string, viewport: Pick<CanvasViewport, "x" | "y" | "zoom">): Promise<void> {
  await (await getDatabase()).put("viewports", {
    id: `canvas:${canvasId}`,
    canvasId,
    ...viewport,
    updatedAt: Date.now(),
  });
}
