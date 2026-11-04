import { describe, expect, it } from "vitest";
import type { Conversation } from "../shared/types";
import { chooseFinalImportState, deriveLibrarySyncState, reconcileSnapshot } from "./import-state";

const rows = (count: number, complete = count): Conversation[] => Array.from({ length: count }, (_, index) => ({
  id: `conversation-${index}`, platform: "chatgpt", title: `Conversation ${index}`, url: `https://chatgpt.com/c/conversation-${index}`,
  updatedAt: 1, messageCount: index < complete ? 2 : 0, importState: index < complete ? "complete" : "discovered",
}));
const ids = (count: number) => Array.from({ length: count }, (_, index) => `conversation-${index}`);

describe("import reconciliation", () => {
  it("reports completed when all 127 rows are durable even if the final request timed out", () => {
    expect(reconcileSnapshot(ids(127), rows(127), ["conversation-126"], [], { "conversation-126": "network" }).finalState).toBe("completed");
  });

  it("reports warnings for 124/127 and partial for 70/127", () => {
    expect(reconcileSnapshot(ids(127), rows(127, 124), ids(127).slice(124), []).finalState).toBe("completed_with_warnings");
    expect(reconcileSnapshot(ids(127), rows(127, 70), ids(127).slice(70), []).finalState).toBe("partial");
  });

  it("distinguishes auth and connection failures when nothing was persisted", () => {
    expect(chooseFinalImportState({ discovered: 0, hydrated: 0, failed: 0, pending: 0, authFailed: true })).toBe("auth_required");
    expect(chooseFinalImportState({ discovered: 0, hydrated: 0, failed: 0, pending: 0, unavailable: true })).toBe("unavailable");
  });

  it("keeps 127 imported rows separate from a disconnected live sync", () => {
    expect(deriveLibrarySyncState(rows(127), null)).toEqual({ libraryDataState: "hydrated", liveSyncState: "disconnected" });
  });

  it("does not count an outdated local body as current after a newer source version fails", () => {
    const stale = { ...rows(1)[0], hydrationState: "hydrated" as const, sourceUpdatedAt: 2, hydratedSourceUpdatedAt: 1 };
    expect(reconcileSnapshot([stale.id], [stale], [stale.id], []).finalState).toBe("partial");
  });
});
