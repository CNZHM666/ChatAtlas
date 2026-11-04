const key = "atlas-source-reading-positions";
interface Position { questionId: string; updatedAt: number }
function positions(): Record<string, Position> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Position> : {};
  } catch { return {}; }
}
export function sourceReadingPosition(conversationId: string): string | undefined {
  const value = positions()[conversationId];
  return typeof value?.questionId === "string" ? value.questionId : undefined;
}
export function saveSourceReadingPosition(conversationId: string, questionId: string): void {
  try {
    const saved = positions();
    if (saved[conversationId]?.questionId === questionId) return;
    saved[conversationId] = { questionId, updatedAt: Date.now() };
    // Keep this separate from project progress so source visits cannot displace projects.
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(Object.entries(saved).sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0)).slice(0, 200))));
  } catch { /* Reading works when local storage is unavailable. */ }
}
