import { getDatabase } from "./db";

export interface ReadingProgress {
  id: string;
  canvasId: string;
  cardId: string;
  messageId?: string;
  scrollTop: number;
  updatedAt: number;
  /** Personal evidence-reading receipt, never a fact/decision verification. */
  sourceReview?: { signature: string; reviewedAt: number };
}

export async function getReadingProgress(canvasId: string, cardId: string): Promise<ReadingProgress | undefined> {
  return (await getDatabase()).get("readingProgress", `${canvasId}:${cardId}`);
}

export async function saveReadingProgress(progress: Omit<ReadingProgress, "id" | "updatedAt">): Promise<ReadingProgress> {
  const saved = { ...progress, id: `${progress.canvasId}:${progress.cardId}`, updatedAt: Date.now() };
  await (await getDatabase()).put("readingProgress", saved);
  return saved;
}

export async function listRecentReading(limit = 5): Promise<ReadingProgress[]> {
  const db = await getDatabase();
  const recent: ReadingProgress[] = [];
  let cursor = await db.transaction("readingProgress").store.index("by-updated").openCursor(null, "prev");
  while (cursor && recent.length < limit) {
    if (!cursor.value.sourceReview) recent.push(cursor.value);
    cursor = await cursor.continue();
  }
  return recent;
}
