import type { AtlasMessage } from "./messages";

export type ProjectChangeNotification = Extract<AtlasMessage, {
  type: "ATLAS_PROJECT_VERSION_SAVED" | "ATLAS_PROJECT_TRASHED" | "ATLAS_PROJECT_RESTORED";
}>;

/** Notify other extension pages after commit. A closed receiver cannot fail the write. */
export function notifyProjectChange(message: ProjectChangeNotification): void {
  try {
    void Promise.resolve(globalThis.chrome?.runtime?.sendMessage?.(message)).catch(() => undefined);
  } catch {
    // An extension context can be invalidated even while its page is still open.
  }
}
