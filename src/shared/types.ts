export type CanvasNodeType = "topic" | "concept" | "note" | "question" | "bridge" | "insight" | "draft" | "portal" | "conversation" | "conversation-root";
export type CardKind = CanvasNodeType;
export type EdgeRelation = "structural" | "attachment" | "bridge";

export interface AtlasCanvas {
  id: string;
  name: string;
  title?: string;
  description?: string;
  type?: "overview" | "topic";
  origin?: "ai" | "user";
  userEdited?: boolean;
  intent?: string;
  sourceConversationIds?: string[];
  readingPathCardIds?: string[];
  readingPathUserEdited?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type KnowledgeCardType = "topic" | "concept" | "bridge" | "insight" | "draft" | "note";
export type KnowledgeOrigin = "ai" | "user" | "user_modified";
export type KnowledgeRelationType = "related_to" | "part_of" | "prerequisite" | "used_for" | "leads_to" | "contrasts_with" | "explains";

export interface KnowledgeCanvas {
  id: string;
  title: string;
  description?: string;
  type: "overview" | "topic";
  origin: "ai" | "user";
  userEdited: boolean;
  intent?: string;
  sourceConversationIds?: string[];
  readingPathCardIds?: string[];
  readingPathUserEdited?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeCard {
  id: string;
  homeCanvasId?: string;
  type: KnowledgeCardType;
  title: string;
  body?: string;
  notes?: string;
  evidenceRefs?: EvidenceRef[];
  tags: string[];
  origin: KnowledgeOrigin;
  userEdited: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasMembership {
  id: string;
  canvasId: string;
  cardId: string;
  x: number;
  y: number;
  userPositioned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface EvidenceRef {
  conversationId: string;
  questionId?: string;
  messageId?: string;
  episodeId?: string;
  excerpt?: string;
}

export type SourceRef = EvidenceRef;
export type OrganizationTaskStatus = "queued" | "running" | "waiting_review" | "completed" | "failed" | "cancelled";
export type OrganizationTaskStage =
  | "preparing" | "question_analysis" | "structure_planning" | "chapter_merge" | "conversation_profiles"
  | "domain_planning" | "concept_canonicalization" | "relation_analysis" | "bridge_insight_generation"
  | "structure_validation" | "proposal_ready";

export type OrganizationTaskEvent =
  | { type: "progress"; message: string; current?: number; total?: number; timestamp: number }
  | { type: "topic_found" | "concept_found"; title: string; sourceRefs: SourceRef[]; timestamp: number }
  | { type: "concept_merged"; from: string[]; to: string; sourceRefs?: SourceRef[]; timestamp: number }
  | { type: "relation_found"; from: string; to: string; relationType: string; sourceRefs: SourceRef[]; timestamp: number }
  | { type: "bridge_created"; title?: string; body: string; sourceRefs: SourceRef[]; timestamp: number }
  | { type: "insight_created"; title: string; body: string; sourceRefs: SourceRef[]; timestamp: number }
  | { type: "draft_suggested"; title: string; body?: string; sourceRefs?: SourceRef[]; timestamp: number }
  | { type: "structure_revision"; message: string; timestamp: number }
  | { type: "proposal_ready"; proposalId: string; timestamp: number }
  | { type: "completed"; timestamp: number };

export interface OrganizationRun {
  diagnosticOnly?: boolean;
  pipelineSpans?: Array<{id:string;feature:import("../ai/ai-diagnostics").AIFeature;phase:string;startedAt:number;durationMs:number;status:"completed"|"failed"|"skipped";reason?:string;counts?:Record<string,number>}>;
  projectStateDraft?: import("./project-state").ProjectState;
  projectAnalysisReview?: "accepted"|"kept";
  projectAnalysis?: { kind: "architecture" | "decisions" | "releases" | "history"; sessionId: string; attemptOrdinal?:number; resultGeneratedAt?:number; phases: Array<{ phase: string; startedAt: number; finishedAt?: number; completed?: number; total?: number }>; reusedRequests: number; reusedWikiSections: number; partial?: boolean };
  id: string;
  title: string;
  intent?: string;
  modelId?: string;
  targetType: "conversation" | "knowledge_canvas" | "knowledge_space";
  targetIds: string[];
  scopeCanvasId?: string;
  permissionBaseUrl?: string;
  permissionModelsUrl?: string;
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
  status: OrganizationTaskStatus;
  stage: OrganizationTaskStage;
  progress: number;
  work?: { current: number; total: number; unit?: "questions" | "conversations" | "checks" };
  activity?: "waiting_model" | "retrying";
  events: OrganizationTaskEvent[];
  proposalId?: string;
  proposalGraph?: ConversationGraph;
  partialChapters?: ConversationChapter[];
  executionStartedAt?: number;
  firstReadableAt?: number;
  readyAt?: number;
  conversationProposals?: Array<{ conversationId: string; graph: ConversationGraph; baselineGraphUpdatedAt?: number; replacesUserEdited?: boolean }>;
  baselineGraphUpdatedAt?: number;
  replacesUserEdited?: boolean;
  error?: string;
  errorCode?: string;
  evaluation?: { score: number; note: string };
  summary?: {
    conceptsAdded?: number; conceptsMerged?: number; relationsAdded?: number;
    bridgesAdded?: number; insightsAdded?: number; draftsSuggested?: number;
  };
}

export interface QuestionSnapshot {
  questionId: string;
  conversationId: string;
  messageIndex?: number;
  displayTitle: string;
  summary: string;
  concepts: string[];
  intent?: string;
  answerKeypoint?: string;
  analysisSource?: "ai" | "fallback";
  analysisModelKey?: string;
  analysisMode?: "fast" | "balanced" | "deep";
  embeddingRef?: string;
  sourceHash: string;
  analysisVersion: number;
  updatedAt: number;
}

export interface AnalysisDiagnostics {
  id: string;
  createdAt: number;
  runId?: string;
  questionsAnalyzed: number;
  cachedQuestionsReused: number;
  rawMessagesLoaded: number;
  aiRequests: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  actualInputTokens?: number;
  actualOutputTokens?: number;
  providerRequests?: number;
  providerUsageReportedRequests?: number;
  relationsVerified: number;
  bridgesGenerated: number;
  questionCount: number;
  topicCount: number;
  relationCount: number;
  bridgeCount: number;
  extractCalls?: number;
  decisionCalls?: number;
  synthesisCalls?: number;
  embeddingCalls?: number;
  cacheHits?: number;
  cacheMisses?: number;
  snapshotsRead?: number;
  judgedPairs?: number;
  retries?: number;
  candidatePairs?: number;
  schemaFailures?: number;
  structuredRetries?: number;
  conceptCount?: number;
  duplicateConceptRate?: number;
  unsupportedRelationRate?: number;
  compressionRatio?: number;
  needsReviewRate?: number;
}

export interface SemanticDecisionCache {
  id: string;
  taskType: "extract" | "decision" | "synthesis";
  inputHash: string;
  analysisVersion: number;
  providerId: string;
  modelId: string;
  result: unknown;
  createdAt: number;
  accessedAt?: number;
  sizeBytes?: number;
}

export type AITaskType = "project_query_plan" | "focus_session" | "conversation_structure" | "embedding" | "question_snapshot" | "conversation_profile" | "chapter_planning" | "knowledge_planning" | "source_retrieval" | "global_merge" | "insight_judge" | "relation_judge" | "composition_judge" | "other";

export interface AIUsageEvent {
  failureOrigin?: "local" | "model" | "provider" | "network";
  /** false only when stopped locally before any provider request. */
  requestSent?: boolean;
  feature?: import("../ai/ai-diagnostics").AIFeature;
  operation?: string;
  operationId?: string;
  parentOperationId?: string;
  recoveryReason?: "output_truncation"|"schema"|"transport";
  recoveryDepth?: number;
  schedulingMs?: number;
  cacheLayer?: "result" | "inflight" | "checkpoint" | "field" | "provider";
  timing?: import("../ai/ai-diagnostics").AITiming;
  queueMs?: number;
  responseMs?: number;
  /** Schema locations only; no provider prose or source content. */
  validationPaths?: string[];
  claimValidation?: Array<{path:string;reason:string}>;
  ownershipValidation?: {expectedSlots:number;receivedSlots:number;reason:"count"|"target"|"slot"};
  directoryValidation?: {missing:number;duplicate:number;unknown:number;parentMismatch:number};
  citationDiagnostics?: { allowedEvidenceCount: number; unknownEvidenceCount: number; citationPaths: string[]; returnedSectionCount?: number; returnedNoteCount?: number };
  estimatedInputTokens?: number;
  /** Provider-reported prompt-cache reads, included in inputTokens; absent when not reported. */
  cachedInputTokens?: number;
  tokenEstimateVersion?: string;
  responseHeadersMs?: number;
  firstTokenMs?: number;
  receivedCharacters?: number;
  reasoningCharacters?: number;
  reasoningTokens?: number;
  outputTokenLimit?: number;
  finishReason?: string;
  timeoutStage?: string;
  streaming?: boolean;
  coveragePlan?: { method: "full_direct" | "full_batched" | "sampled"; sourceCharacters: number; materialBlocks: number; plannedBatches: number };
  errorCode?: string;
  stage?: string;
  taskVersion?: string;
  requestStartedAt?: number;
  id: string;
  createdAt: number;
  runId?: string;
  durationMs?: number;
  taskType: AITaskType;
  providerId: string;
  modelId: string;
  conversationIds: string[];
  inputTokens: number;
  outputTokens: number;
  tokenSource: "provider" | "estimated" | "unavailable";
  status: "completed" | "failed" | "cached";
  embeddingTokens?: number;
  costCny?: number;
  pendingCostCny?: number;
  requestId?: string;
  attempt: number;
}

export interface KnowledgeRelation {
  id: string;
  fromCardId: string;
  toCardId: string;
  type: KnowledgeRelationType;
  label?: string;
  origin: "ai" | "user";
  status: "proposed" | "proposed_low_confidence" | "accepted" | "rejected";
  evidenceRefs: EvidenceRef[];
  confidenceBand?: "high" | "medium" | "low";
  importance?: "strong" | "medium" | "weak";
  requiresExplanation?: boolean;
  proposedLowConfidence?: boolean;
  userEdited?: boolean;
  userRejected?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SourceRelation {
  id: string;
  cardId: string;
  sourceType: "conversation" | "message";
  sourceId: string;
  conversationId: string;
  createdAt: number;
}

export interface ConversationSemanticProfile {
  conversationId: string;
  title?: string;
  summary: string;
  domains: string[];
  topics: string[];
  concepts: string[];
  intent: string;
  intents?: string[];
  questionCount?: number;
  analysisVersion?: number;
  analysisSource?: "ai" | "fallback";
  analysisModelKey?: string;
  analysisMode?: "fast" | "balanced" | "deep";
  coverage?: "complete" | "sampled";
  evidenceRefs: EvidenceRef[];
  analyzedVersion: string;
  updatedAt: number;
}

export interface KnowledgeProposal {
  id: string;
  status: "preview" | "applied" | "cancelled";
  mode: "initial" | "incremental";
  canvases: KnowledgeCanvas[];
  cards: KnowledgeCard[];
  memberships: CanvasMembership[];
  relations: KnowledgeRelation[];
  sources: SourceRelation[];
  evidenceUpdates?: Array<{ cardId: string; refs: EvidenceRef[] }>;
  evidenceRefChanges?: Array<{ cardId: string; refs: EvidenceRef[] }>;
  relationChanges?: Array<{ id: string; before?: KnowledgeRelation }>;
  membershipChanges?: Array<{ id: string; before?: CanvasMembership }>;
  scopeUpdates?: Array<{ canvasId: string; intent: string; sourceConversationIds: string[]; readingPathCardIds: string[]; baselineUpdatedAt: number; before?: { intent?: string; sourceConversationIds?: string[]; readingPathCardIds?: string[] } }>;
  analyzedConversationIds: string[];
  reviewConversationIds: string[];
  analysisWarnings?: number;
  conversationGraphChanges?: Array<{ conversationId: string; before?: ConversationGraph; appliedAt: number }>;
  createdAt: number;
  updatedAt: number;
}

export interface AISettings {
  id: "ai-settings";
  mode?: "demo" | "byok";
  provider: "openai" | "anthropic" | "gemini" | "deepseek" | "qwen" | "moonshot" | "zhipu" | "minimax" | "siliconflow" | "baidu" | "volcengine" | "tencent" | "lingyi" | "stepfun" | "openrouter" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  economyModel?: string;
  embeddingModel?: string;
  embeddingVersion?: string;
  analysisMode?: "fast" | "balanced" | "deep";
  streaming?: boolean;
  connections?: AIConnection[];
  updatedAt: number;
}

/** Locally saved connections; excluded with AI settings from knowledge backups. */
export type AIConnection = Pick<AISettings, "provider" | "baseUrl" | "apiKey" | "model" | "economyModel" | "embeddingModel" | "embeddingVersion" | "streaming">;

export interface Conversation {
  sourceAccount?: string;
  nativeHistorySourceId?: string;
  /** DOM windows must never overwrite an API completeness receipt. */
  historyCoverage?: "loaded" | "complete";
  /** Fingerprint of locally retained originals, independent of platform timestamps. */
  rawRevision?: string;
  id: string;
  platform: "chatgpt" | (string & {});
  title: string;
  url: string;
  createdAt?: number;
  updatedAt: number;
  sourceCreatedAt?: number;
  sourceUpdatedAt?: number;
  /** Source timestamp of the conversation body last persisted successfully. */
  hydratedSourceUpdatedAt?: number;
  source?: "chatgpt_live" | "chatgpt_export" | (string & {});
  sourceRevision?: string;
  /** Null means that ChatGPT supplied metadata but the message body is not known yet. */
  messageCount: number | null;
  hydrationState?: ConversationHydrationState;
  summary?: string;
  tags?: string[];
  importState?: "discovered" | "complete" | "failed";
}

export type ConversationHydrationState = "metadata_only" | "queued" | "syncing" | "hydrated" | "rate_limited" | "retry_wait" | "failed";

export type ImportState =
  | "idle"
  | "inventory_ready"
  | "connecting"
  | "discovering"
  | "syncing"
  | "reconciling"
  | "completed"
  | "completed_with_warnings"
  | "partial"
  | "auth_required"
  | "unavailable"
  | "failed"
  | "paused";

export type ImportItemState = "pending" | "fetching" | "persisted" | "failed" | "retrying";
export type ImportFailureCategory = "network" | "rate_limit" | "auth" | "not_found" | "permission" | "parse_error" | "storage_error" | "bridge_error" | "unknown";

export interface ImportCheckpoint {
  sessionId: string;
  discoveredIds: string[];
  persistedIds: string[];
  failedIds: string[];
  pendingIds: string[];
  lastCursor: string;
  startedAt: number;
  updatedAt: number;
}

export interface ImportItemStatus {
  id: string;
  sessionId: string;
  conversationId: string;
  state: ImportItemState;
  retryCount: number;
  failureCategory?: ImportFailureCategory;
  error?: string;
  nextRetryAt?: number;
  updatedAt: number;
}

export interface ImportReconciliationResult {
  discovered: number;
  persisted: number;
  hydrated: number;
  failed: number;
  pending: number;
  finalState: ImportState;
}

export interface ImportDiagnostics {
  id: "lastImportDiagnostics";
  sessionId: string;
  stage: ImportState;
  discovered: number;
  persisted: number;
  hydrated: number;
  failed: number;
  retried: number;
  rateLimitCount?: number;
  timeoutCount?: number;
  averageRequestDuration?: number;
  currentConcurrency?: number;
  pendingIds?: string[];
  failedIds?: string[];
  duration: number;
  finalState: ImportState;
  events: Array<{ at: number; stage: string; conversationId?: string; retryCount?: number; category?: ImportFailureCategory; message?: string; durationMs?: number }>;
  reconciliation?: ImportReconciliationResult;
  updatedAt: number;
}

export interface ImportJob {
  native?: import("./native-import").NativeImportState;
  id: "chatgpt-history";
  sessionId: string;
  retryScope?: "full" | "incremental" | "failed" | "titles" | "selected";
  status: ImportState;
  phase: "connecting" | "discovering" | "syncing" | "reconciling";
  connectionStep?: "finding_chatgpt_tab" | "connecting_content_script" | "connecting_page_bridge" | "checking_session";
  scope?: "active" | "archived";
  inventoryComplete?: boolean;
  offset: number;
  discovered: number;
  discoveredIds?: string[];
  persisted: number;
  persistedIds: string[];
  hydrated: number;
  completed: number;
  failed: number;
  syncedMessages?: number;
  bulkReport?: { added: number; updated: number; unchanged: number; failed: number };
  lastSyncedAt?: number;
  pendingIds: string[];
  priorityIds?: string[];
  retryAfterAt?: number;
  currentConcurrency?: number;
  failedIds: string[];
  /** Requests actually dispatched, including an explicit retry wait. */
  activeIds?: string[];
  retryingIds?: string[];
  priorityPendingIds?: string[];
  failureReasons?: Record<string, string>;
  lastError?: string;
  diagnostic?: ImportDiagnostic;
  checkpoint: ImportCheckpoint;
  reconciliation?: ImportReconciliationResult;
  startedAt: number;
  updatedAt: number;
}

export type ImportDiagnosticCode = "NO_CHATGPT_TAB" | "NO_CONTENT_SCRIPT" | "BRIDGE_INJECTION_FAILED" | "SESSION_UNAVAILABLE" | "DISCOVERY_FAILED" | "EMPTY_INVENTORY" | "REQUEST_FAILED";

export interface ImportDiagnostic {
  stage: "tab" | "content-script" | "bridge" | "session" | "discovery" | "sync";
  success: boolean;
  code?: ImportDiagnosticCode;
  message?: string;
}

export type ConversationOrganizationState = "unprocessed" | "suggested" | "confirmed" | "needs-review";

export interface OrganizationSuggestion {
  id: string;
  topicId?: string;
  suggestedTopicTitle: string;
  description?: string;
  conversationIds: string[];
  confidence: number;
  reason?: string;
}

export interface OrganizationReviewItem {
  conversationId: string;
  candidates: Array<{ topicId?: string; title: string; confidence: number }>;
}

export interface OrganizationPlan {
  id: string;
  canvasId: string;
  status: "preview" | "applied";
  suggestions: OrganizationSuggestion[];
  reviewItems: OrganizationReviewItem[];
  conversationStates: Record<string, ConversationOrganizationState>;
  analyzedConversationIds: string[];
  coverage?: { highConfidence: number; mediumConfidence: number; unassigned: number; ratio: number };
  analysisQuality?: "ready" | "needs-more-analysis";
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessage {
  /** Original provider timestamp only; DOM capture/sync time is not a discussion date. */
  sourceCreatedAt?: number;
  id: string;
  conversationId: string;
  platformMessageId?: string;
  /** Active conversation-tree user turn answered by this assistant message; optional for older captures. */
  replyToMessageId?: string;
  messageIndex: number;
  role: "user" | "assistant";
  content: string;
  /** Original typed UI parts, keyed by placeholder occurrence in content. Never executable in the extension. */
  uiParts?: Array<{ ordinal: number; raw: string; fallbackText?: string; truncated?: boolean }>;
  preview: string;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationCapture {
  conversation: Conversation;
  messages: ConversationMessage[];
  capturedAt: number;
}

export type ConversationGraphNodeKind = CanvasNodeType | "chapter";

export interface ConversationChapter {
  phase?: string;
  transition?: string;
  id: string;
  conversationId: string;
  title: string;
  summary?: string;
  questionIds: string[];
  order: number;
  x?: number;
  y?: number;
  collapsed: boolean;
  source: "auto" | "user";
  createdManually?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A contiguous portion of a chapter to read with its original messages intact. */
export interface ContextEpisode {
  id: string;
  chapterId: string;
  conversationId: string;
  title: string;
  summary?: string;
  concepts?: string[];
  contextHeader?: string;
  questionIds: string[];
  messageIds: string[];
  sourceHash?: string;
  analysisVersion?: number;
}

export type QuestionRelationType = "continue" | "branch" | "return";
export interface QuestionRelation { sourceId: string; targetId: string; type: QuestionRelationType; }

export interface ConversationGraphNode {
  id: string;
  conversationId: string;
  kind: ConversationGraphNodeKind;
  title: string;
  displayTitle?: string;
  displayTitleSource?: "generated" | "user" | "fallback";
  description?: string;
  sourceMessageId?: string;
  evidenceRefs?: EvidenceRef[];
  answerMessageId?: string;
  answerPreview?: string;
  answerCharCount?: number;
  sourceCreatedAt?: number;
  role?: "user" | "assistant";
  x: number;
  y: number;
  positionSource?: "auto" | "user";
}

export interface ConversationGraphEdge {
  id: string;
  conversationId: string;
  source: string;
  target: string;
  relation: EdgeRelation;
}

export interface ConversationGraph {
  analysisModelKey?: string;
  analysisMode?: "fast" | "balanced" | "deep";
  conversationId: string;
  sourceHash?: string;
  organizationMode?: "manual" | "ai";
  analyzedVersion?: string;
  nodes: ConversationGraphNode[];
  edges: ConversationGraphEdge[];
  chapters?: ConversationChapter[];
  episodes?: ContextEpisode[];
  questionRelations?: QuestionRelation[];
  /** User understanding cards inserted between source chapters; chapter order stays chronological. */
  understandingRoute?: Array<{ kind: "chapter" | "card"; id: string }>;
  userEdited?: boolean;
  analysisVersion?: number;
  chapterLayoutVersion?: number;
  updatedAt: number;
}

export interface MessageAnchor {
  id: string;
  conversationId: string;
  conversationUrl: string;
  messageId?: string;
  messageIndex?: number;
  role: "user" | "assistant";
  preview: string;
  contentHash: string;
  createdAt: number;
}

export interface CanvasCard {
  id: string;
  canvasId: string;
  kind: CardKind;
  title: string;
  description?: string;
  notes?: string;
  x: number;
  y: number;
  tags: string[];
  anchorIds: string[];
  conversationIds: string[];
  evidenceRefs?: EvidenceRef[];
  createdAt: number;
  updatedAt: number;
  layoutLocked?: boolean;
  origin?: KnowledgeOrigin;
  userEdited?: boolean;
  homeCanvasId?: string;
  ghost?: boolean;
  portalCanvasId?: string;
  portalTargetCardId?: string;
}

export interface CanvasEdge {
  id: string;
  canvasId: string;
  source: string;
  target: string;
  type: "manual" | "suggested";
  relation?: EdgeRelation;
  knowledgeRelationType?: KnowledgeRelationType;
  label?: string;
  evidenceRefs?: EvidenceRef[];
  status?: KnowledgeRelation["status"];
  createdAt: number;
}

export interface CanvasViewport {
  id: string;
  canvasId: string;
  x: number;
  y: number;
  zoom: number;
  updatedAt: number;
}

export interface SuggestedCard {
  id: string;
  title: string;
  reason: string;
  sourceCardId?: string;
}
