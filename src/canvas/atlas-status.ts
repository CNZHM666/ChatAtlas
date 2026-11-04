import type { Conversation, ImportJob, KnowledgeProposal } from "../shared/types";
import { isCurrentHydrationComplete } from "../sync/import-state";

export type LibraryDataState = "empty" | "metadata_only" | "ready" | "partial";
export type LiveSyncState = "hidden" | "connecting" | "syncing" | "synced" | "disconnected" | "attention";
export type KnowledgeOrganizationState = "empty" | "analyzing" | "preview" | "ready";

export interface AtlasProductStatus {
  library: { state: LibraryDataState; available: number; total: number };
  liveSync: { state: LiveSyncState; percent?: number; failed: number; lastSyncedAt?: number };
  knowledge: { state: KnowledgeOrganizationState; domainCount: number };
}

export type KnowledgeSpacePhase =
  | "demo_idle"
  | "demo_syncing"
  | "demo_synced_ready"
  | "demo_partial_ready"
  | "organizing"
  | "organized"
  | "auth_required"
  | "sync_failed";

export type KnowledgeBuildState = "not_started" | "organizing" | "preview" | "organized";

export interface KnowledgeSpaceUiState {
  phase: KnowledgeSpacePhase;
  sync: {
    state: "idle" | "syncing" | "synced" | "partial" | "disconnected" | "auth_required" | "failed";
    completed: number;
    discovered: number;
    failed: number;
    lastSyncedAt?: number;
  };
  domainCount: number;
  proposalDomainCount: number;
}

const activeSyncStates = new Set<ImportJob["status"]>(["connecting", "discovering", "syncing", "reconciling"]);

export function deriveKnowledgeSpaceUiState(input: {
  syncState: ImportJob["status"] | null;
  knowledgeBuildState: KnowledgeBuildState;
  discoveredCount: number;
  persistedCount: number;
  failedCount: number;
  domainCount: number;
  proposalDomainCount?: number;
  hasImportedData: boolean;
  lastSyncedAt?: number;
}): KnowledgeSpaceUiState {
  const syncState = input.syncState;
  const sync = activeSyncStates.has(syncState as ImportJob["status"])
    ? "syncing"
    : syncState === "completed"
      ? "synced"
      : syncState === "completed_with_warnings" || syncState === "partial" || syncState === "paused"
        ? "partial"
        : syncState === "auth_required"
          ? "auth_required"
          : syncState === "failed" || syncState === "unavailable"
            ? "failed"
            : input.hasImportedData
              ? "disconnected"
              : "idle";

  let phase: KnowledgeSpacePhase;
  if (input.knowledgeBuildState === "organizing" || input.knowledgeBuildState === "preview") phase = "organizing";
  else if (input.knowledgeBuildState === "organized" || input.domainCount > 0) phase = "organized";
  else if (sync === "syncing") phase = input.hasImportedData ? "demo_synced_ready" : "demo_syncing";
  else if (sync === "auth_required" && !input.hasImportedData) phase = "auth_required";
  else if (sync === "failed" && !input.hasImportedData) phase = "sync_failed";
  else if ((sync === "partial" || sync === "failed" || sync === "auth_required") && input.hasImportedData) phase = input.failedCount > 0 ? "demo_partial_ready" : "demo_synced_ready";
  else if (sync === "synced" || input.hasImportedData) phase = input.failedCount > 0 ? "demo_partial_ready" : "demo_synced_ready";
  else phase = "demo_idle";

  return {
    phase,
    sync: {
      state: sync,
      completed: input.persistedCount,
      discovered: input.discoveredCount,
      failed: input.failedCount,
      lastSyncedAt: input.lastSyncedAt,
    },
    domainCount: input.domainCount,
    proposalDomainCount: input.proposalDomainCount ?? 0,
  };
}

export function deriveAtlasProductStatus(input: {
  conversations: Conversation[];
  importJob: ImportJob | null;
  domainCount: number;
  proposal: KnowledgeProposal | null;
  analyzing: boolean;
}): AtlasProductStatus {
  const available = input.conversations.filter(isCurrentHydrationComplete).length;
  const failedConversations = input.conversations.filter((conversation) => conversation.importState === "failed").length;
  const libraryState: LibraryDataState = !input.conversations.length ? "empty"
    : !available ? "metadata_only"
    : failedConversations || input.conversations.some((conversation) => !isCurrentHydrationComplete(conversation)) ? "partial"
    : "ready";
  const job = input.importJob;
  let liveSyncState: LiveSyncState = "hidden";
  let percent: number | undefined;
  if (job && activeSyncStates.has(job.status)) {
    liveSyncState = job.status === "syncing" ? "syncing" : "connecting";
    if (job.status === "syncing" && job.discovered > 0) {
      const calculated = Math.round(job.hydrated / job.discovered * 100);
      if (calculated > 0) percent = Math.min(100, calculated);
    }
  } else if (job?.status === "completed") liveSyncState = "synced";
  else if (job?.status === "completed_with_warnings" || job?.status === "partial" || job?.status === "failed" || job?.status === "auth_required" || job?.status === "unavailable") liveSyncState = "attention";
  else if (available > 0) liveSyncState = job?.lastSyncedAt ? "synced" : "disconnected";

  const proposalDomainCount = input.proposal?.canvases.length ?? 0;
  const knowledgeState: KnowledgeOrganizationState = input.analyzing ? "analyzing"
    : input.proposal ? "preview"
    : input.domainCount > 0 ? "ready"
    : "empty";
  return {
    library: { state: libraryState, available, total: input.conversations.length },
    liveSync: { state: liveSyncState, percent, failed: job?.failed ?? failedConversations, lastSyncedAt: job?.lastSyncedAt },
    knowledge: { state: knowledgeState, domainCount: Math.max(input.domainCount, proposalDomainCount) },
  };
}
