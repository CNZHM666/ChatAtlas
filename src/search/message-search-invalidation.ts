/** Storage runs in pages and workers. Notify loaded readers without importing
 * their index through a DOM-based build preload helper in the import process. */
const listeners = new Set<() => void>();

export function onMessageSearchInvalidation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function invalidateMessageSearchReaders(): void {
  for (const listener of listeners) listener();
}
