/** The nearest ancestor that scrolls, which is what the reader moves when it keeps or finds a place. */
export function readerScrollContainer(element: HTMLElement | null): HTMLElement | null {
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/u.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return element?.closest<HTMLElement>("main, aside") ?? null;
}
