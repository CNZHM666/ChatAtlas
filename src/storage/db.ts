import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AISettings, AIUsageEvent, AnalysisDiagnostics, AtlasCanvas, CanvasCard, CanvasEdge, CanvasMembership, CanvasViewport, Conversation, ConversationGraph, ConversationMessage, ConversationSemanticProfile, ImportDiagnostics, ImportItemStatus, ImportJob, KnowledgeCard, KnowledgeProposal, KnowledgeRelation, MessageAnchor, OrganizationPlan, OrganizationRun, QuestionSnapshot, SemanticDecisionCache, SourceRelation } from "../shared/types";

export interface AtlasDB extends DBSchema {
  discussionHighlights: { key: string; value: import("./discussion-highlights").DiscussionHighlightEdit; indexes: { "by-conversation": string } };
  homeResults: { key: string; value: import("./home-results").HomeResult; indexes: { "by-created": number } };
  messageSearchDocuments: { key: string; value: import("../search/message-search-store").MessageSearchDocument; indexes: { generation: string } };
  messageSearchManifests: { key: string; value: import("../search/message-search-store").MessageSearchManifest; indexes: { generation: string; conversation: [string, string] } };
  messageSearchState: { key: string; value: import("../search/message-search-store").MessageSearchState };
  contextFavorites: { key: string; value: import("./context-favorites").ContextFavorite };
  sidecarSearches: { key: string; value: import("./context-favorites").SidecarSearch };
  projectHistoryTasks: { key: string; value: import("./project-history-tasks").ProjectHistoryTask };
  sourceVersions: { key: string; value: import("./source-versions").SourceVersion; indexes: { "by-conversation": string } };
  knowledgeIndexes: { key: string; value: import("../shared/knowledge-index").KnowledgeIndex };
  projectQueryThreads: { key: string; value: import("./project-query-threads").ProjectQueryThread };
  focusGenerationTasks: { key: string; value: import("./focus-generation-tasks").FocusGenerationTask; indexes: { "by-updated": number } };
  focusSessions: { key: string; value: import("../shared/focus-session").FocusSession; indexes: { "by-updated": number } };
  reviewMarks: { key: string; value: { id: string; cardId: string; canvasId: string; conversationId: string; messageId: string; kind: "conclusion" | "decision"; originalText: string; updateNote: string; createdAt: number; updatedAt: number }; indexes: { "by-card": string } };
  readingProgress: { key: string; value: import("./reading-progress").ReadingProgress; indexes: { "by-updated": number } };
  transcriptIndexes: { key: string; value: { id: string; fingerprint: string; passages: import("../search/transcript-index").TranscriptPassage[] } };
  canvases: { key: string; value: AtlasCanvas; indexes: { "by-updated": number } };
  cards: { key: string; value: CanvasCard; indexes: { "by-updated": number } };
  edges: { key: string; value: CanvasEdge };
  conversations: { key: string; value: Conversation; indexes: { "by-updated": number } };
  anchors: {
    key: string;
    value: MessageAnchor;
    indexes: { "by-conversation": string; "by-created": number };
  };
  messages: {
    key: string;
    value: ConversationMessage;
    indexes: { "by-conversation": string; "by-updated": number };
  };
  viewports: { key: string; value: CanvasViewport };
  conversationGraphs: { key: string; value: ConversationGraph };
  importJobs: { key: string; value: ImportJob };
  importItems: { key: string; value: ImportItemStatus; indexes: { "by-session": string; "by-conversation": string } };
  diagnostics: { key: string; value: ImportDiagnostics };
  organizationPlans: { key: string; value: OrganizationPlan; indexes: { "by-updated": number } };
  knowledgeCards: { key: string; value: KnowledgeCard; indexes: { "by-updated": number } };
  canvasMemberships: { key: string; value: CanvasMembership; indexes: { "by-canvas": string; "by-card": string } };
  knowledgeRelations: { key: string; value: KnowledgeRelation; indexes: { "by-from": string; "by-to": string; "by-status": string } };
  sourceRelations: { key: string; value: SourceRelation; indexes: { "by-card": string; "by-conversation": string } };
  knowledgeProposals: { key: string; value: KnowledgeProposal; indexes: { "by-updated": number; "by-status": string } };
  semanticProfiles: { key: string; value: ConversationSemanticProfile; indexes: { "by-updated": number } };
  questionSnapshots: { key: string; value: QuestionSnapshot; indexes: { "by-conversation": string } };
  analysisDiagnostics: { key: string; value: AnalysisDiagnostics };
  semanticDecisionCache: { key: string; value: SemanticDecisionCache };
  aiSettings: { key: string; value: AISettings };
  aiUsageEvents: { key: string; value: AIUsageEvent; indexes: { "by-created": number } };
  organizationRuns: { key: string; value: OrganizationRun; indexes: { "by-updated": number; "by-status": string } };
  semanticVectors: { key: string; value: { id: string; modelKey: string; textHash: string; values: number[]; updatedAt: number; embeddingProvider?: string; embeddingModel?: string; embeddingDimension?: number; embeddingVersion?: string } };
}

let database: Promise<IDBPDatabase<AtlasDB>> | undefined;

export function getDatabase(): Promise<IDBPDatabase<AtlasDB>> {
  database ??= openDB<AtlasDB>("ai-conversation-atlas", 24, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("discussionHighlights")) db.createObjectStore("discussionHighlights", { keyPath: "id" }).createIndex("by-conversation", "conversationId");
      if (!db.objectStoreNames.contains("homeResults")) db.createObjectStore("homeResults", { keyPath: "id" }).createIndex("by-created", "createdAt");
      if (!db.objectStoreNames.contains("messageSearchDocuments")) db.createObjectStore("messageSearchDocuments", { keyPath: "id" }).createIndex("generation", "generation");
      if (!db.objectStoreNames.contains("messageSearchManifests")) {
        const manifests = db.createObjectStore("messageSearchManifests", { keyPath: "id" });
        manifests.createIndex("generation", "generation"); manifests.createIndex("conversation", ["generation", "conversationId"]);
      }
      if (!db.objectStoreNames.contains("messageSearchState")) db.createObjectStore("messageSearchState", { keyPath: "id" });
      if (!db.objectStoreNames.contains("contextFavorites")) db.createObjectStore("contextFavorites", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sidecarSearches")) db.createObjectStore("sidecarSearches", { keyPath: "id" });
      if (!db.objectStoreNames.contains("projectHistoryTasks")) db.createObjectStore("projectHistoryTasks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sourceVersions")) db.createObjectStore("sourceVersions", { keyPath: "id" }).createIndex("by-conversation", "conversationId");
      if (!db.objectStoreNames.contains("knowledgeIndexes")) db.createObjectStore("knowledgeIndexes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("projectQueryThreads")) db.createObjectStore("projectQueryThreads", { keyPath: "id" });
      if (!db.objectStoreNames.contains("focusGenerationTasks")) {
        const tasks = db.createObjectStore("focusGenerationTasks", { keyPath: "id" });
        tasks.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("focusSessions")) {
        const sessions = db.createObjectStore("focusSessions", { keyPath: "id" });
        sessions.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("reviewMarks")) {
        const marks = db.createObjectStore("reviewMarks", { keyPath: "id" });
        marks.createIndex("by-card", "cardId");
      }
      if (!db.objectStoreNames.contains("transcriptIndexes")) db.createObjectStore("transcriptIndexes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("readingProgress")) {
        const progress = db.createObjectStore("readingProgress", { keyPath: "id" });
        progress.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("canvases")) {
        const canvases = db.createObjectStore("canvases", { keyPath: "id" });
        canvases.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("cards")) {
        const cards = db.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("edges")) db.createObjectStore("edges", { keyPath: "id" });
      if (!db.objectStoreNames.contains("conversations")) {
        const conversations = db.createObjectStore("conversations", { keyPath: "id" });
        conversations.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("anchors")) {
        const anchors = db.createObjectStore("anchors", { keyPath: "id" });
        anchors.createIndex("by-conversation", "conversationId");
        anchors.createIndex("by-created", "createdAt");
      }
      if (!db.objectStoreNames.contains("messages")) {
        const messages = db.createObjectStore("messages", { keyPath: "id" });
        messages.createIndex("by-conversation", "conversationId");
        messages.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("viewports")) db.createObjectStore("viewports", { keyPath: "id" });
      if (!db.objectStoreNames.contains("conversationGraphs")) db.createObjectStore("conversationGraphs", { keyPath: "conversationId" });
      if (!db.objectStoreNames.contains("importJobs")) db.createObjectStore("importJobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("importItems")) {
        const items = db.createObjectStore("importItems", { keyPath: "id" });
        items.createIndex("by-session", "sessionId");
        items.createIndex("by-conversation", "conversationId");
      }
      if (!db.objectStoreNames.contains("diagnostics")) db.createObjectStore("diagnostics", { keyPath: "id" });
      if (!db.objectStoreNames.contains("organizationPlans")) {
        const plans = db.createObjectStore("organizationPlans", { keyPath: "id" });
        plans.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("knowledgeCards")) {
        const cards = db.createObjectStore("knowledgeCards", { keyPath: "id" });
        cards.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("canvasMemberships")) {
        const memberships = db.createObjectStore("canvasMemberships", { keyPath: "id" });
        memberships.createIndex("by-canvas", "canvasId");
        memberships.createIndex("by-card", "cardId");
      }
      if (!db.objectStoreNames.contains("knowledgeRelations")) {
        const relations = db.createObjectStore("knowledgeRelations", { keyPath: "id" });
        relations.createIndex("by-from", "fromCardId");
        relations.createIndex("by-to", "toCardId");
        relations.createIndex("by-status", "status");
      }
      if (!db.objectStoreNames.contains("sourceRelations")) {
        const sources = db.createObjectStore("sourceRelations", { keyPath: "id" });
        sources.createIndex("by-card", "cardId");
        sources.createIndex("by-conversation", "conversationId");
      }
      if (!db.objectStoreNames.contains("knowledgeProposals")) {
        const proposals = db.createObjectStore("knowledgeProposals", { keyPath: "id" });
        proposals.createIndex("by-updated", "updatedAt");
        proposals.createIndex("by-status", "status");
      }
      if (!db.objectStoreNames.contains("semanticProfiles")) {
        const profiles = db.createObjectStore("semanticProfiles", { keyPath: "conversationId" });
        profiles.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("questionSnapshots")) {
        const snapshots = db.createObjectStore("questionSnapshots", { keyPath: "questionId" });
        snapshots.createIndex("by-conversation", "conversationId");
      }
      if (!db.objectStoreNames.contains("analysisDiagnostics")) db.createObjectStore("analysisDiagnostics", { keyPath: "id" });
      if (!db.objectStoreNames.contains("semanticDecisionCache")) db.createObjectStore("semanticDecisionCache", { keyPath: "id" });
      if (!db.objectStoreNames.contains("aiSettings")) db.createObjectStore("aiSettings", { keyPath: "id" });
      if (!db.objectStoreNames.contains("aiUsageEvents")) {
        const usage = db.createObjectStore("aiUsageEvents", { keyPath: "id" });
        usage.createIndex("by-created", "createdAt");
      }
      if (!db.objectStoreNames.contains("organizationRuns")) {
        const runs = db.createObjectStore("organizationRuns", { keyPath: "id" });
        runs.createIndex("by-updated", "updatedAt");
        runs.createIndex("by-status", "status");
      }
      if (!db.objectStoreNames.contains("semanticVectors")) db.createObjectStore("semanticVectors", { keyPath: "id" });
    },
  });
  return database;
}
