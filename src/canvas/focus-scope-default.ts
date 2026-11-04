/** Above this, reading every source dominates the wait (minutes per 100k characters). */
export const LARGE_SCOPE_CHARACTERS = 150_000;

/** Large material starts with the related discussions only; small material is organized in full. */
export function focusScopeDefault(items: Array<{ characters: number }>): "goal" | "all" {
  return items.reduce((sum, item) => sum + item.characters, 0) > LARGE_SCOPE_CHARACTERS ? "goal" : "all";
}
