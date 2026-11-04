import { describe, expect, it } from "vitest";
import type { Conversation, ImportJob } from "../shared/types";
import { deriveAtlasProductStatus, deriveKnowledgeSpaceUiState, type KnowledgeBuildState } from "./atlas-status";

const conversation: Conversation = { id: "ready", platform: "chatgpt", title: "Ready", url: "https://chatgpt.com/c/ready", updatedAt: 1, messageCount: 2, importState: "complete" };
const job = (status: ImportJob["status"], overrides: Partial<ImportJob> = {}): ImportJob => ({
  id: "chatgpt-history", sessionId: "session", status, phase: "syncing", offset: 0, discovered: 0,
  persisted: 0, persistedIds: [], hydrated: 0, completed: 0, failed: 0, pendingIds: [], failedIds: [],
  checkpoint: { sessionId: "session", discoveredIds: [], persistedIds: [], failedIds: [], pendingIds: [], lastCursor: "0", startedAt: 1, updatedAt: 1 },
  startedAt: 1, updatedAt: 1, ...overrides,
});

describe("ChatAtlas product status", () => {
  it("keeps imported data separate from disconnected live sync and empty knowledge", () => {
    const status = deriveAtlasProductStatus({ conversations: [conversation], importJob: null, domainCount: 0, proposal: null, analyzing: false });
    expect(status.library).toMatchObject({ state: "ready", available: 1 });
    expect(status.liveSync.state).toBe("disconnected");
    expect(status.knowledge.state).toBe("empty");
  });

  it("never exposes a zero-percent engineering state", () => {
    const status = deriveAtlasProductStatus({ conversations: [conversation], importJob: job("syncing", { discovered: 12, hydrated: 0 }), domainCount: 0, proposal: null, analyzing: false });
    expect(status.liveSync).toMatchObject({ state: "syncing", percent: undefined });
  });

  it("reports real sync progress without claiming knowledge is ready", () => {
    const status = deriveAtlasProductStatus({ conversations: [conversation], importJob: job("syncing", { discovered: 100, hydrated: 32 }), domainCount: 0, proposal: null, analyzing: false });
    expect(status.liveSync).toMatchObject({ state: "syncing", percent: 32 });
    expect(status.knowledge.state).toBe("empty");
  });

  it("does not count a stale saved body as freshly hydrated", () => {
    const status = deriveAtlasProductStatus({ conversations: [{ ...conversation, hydrationState: "queued" }], importJob: null, domainCount: 0, proposal: null, analyzing: false });
    expect(status.library).toMatchObject({ state: "metadata_only", available: 0 });
  });
});

const knowledgeState = (overrides: Partial<Parameters<typeof deriveKnowledgeSpaceUiState>[0]> = {}) => deriveKnowledgeSpaceUiState({
  syncState: null,
  knowledgeBuildState: "not_started" as KnowledgeBuildState,
  discoveredCount: 0,
  persistedCount: 0,
  failedCount: 0,
  domainCount: 0,
  hasImportedData: false,
  ...overrides,
});

describe("knowledge space UI state", () => {
  it("allows a knowledge space as soon as conversations are ready during sync", () => {
    expect(knowledgeState({ syncState: "syncing", discoveredCount: 127, persistedCount: 12, hasImportedData: true })).toMatchObject({
      phase: "demo_synced_ready",
      sync: { state: "syncing", completed: 12, discovered: 127 },
    });
    expect(knowledgeState({ syncState: "syncing", discoveredCount: 127, persistedCount: 0, hasImportedData: false }).phase).toBe("demo_syncing");
  });

  it("shows a demo ready state after sync instead of inventing real domains", () => {
    expect(knowledgeState({ syncState: "completed", discoveredCount: 127, persistedCount: 127, hasImportedData: true }).phase).toBe("demo_synced_ready");
  });

  it("allows organization after a small partial failure", () => {
    expect(knowledgeState({ syncState: "completed_with_warnings", discoveredCount: 127, persistedCount: 124, failedCount: 3, hasImportedData: true }).phase).toBe("demo_partial_ready");
    expect(knowledgeState({ syncState: "paused", persistedCount: 12, hasImportedData: true }).phase).toBe("demo_synced_ready");
  });

  it("maps analysis and preview to one organizing experience", () => {
    expect(knowledgeState({ knowledgeBuildState: "organizing", hasImportedData: true }).phase).toBe("organizing");
    expect(knowledgeState({ knowledgeBuildState: "preview", proposalDomainCount: 6, hasImportedData: true }).phase).toBe("organizing");
  });

  it("lets a real knowledge space win over disconnected live sync", () => {
    expect(knowledgeState({ knowledgeBuildState: "organized", domainCount: 6, hasImportedData: true }).phase).toBe("organized");
    expect(knowledgeState({ knowledgeBuildState: "organized", domainCount: 6, hasImportedData: true }).sync.state).toBe("disconnected");
  });

  it("distinguishes authentication from a hard sync failure", () => {
    expect(knowledgeState({ syncState: "auth_required" }).phase).toBe("auth_required");
    expect(knowledgeState({ syncState: "failed" }).phase).toBe("sync_failed");
    expect(knowledgeState({ syncState: "auth_required", persistedCount: 125, discoveredCount: 127, failedCount: 2, hasImportedData: true }).phase).toBe("demo_partial_ready");
  });
});
