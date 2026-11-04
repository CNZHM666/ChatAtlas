import type { UnderstandingRelationKind } from "./understanding-relations";
import type { ProjectState, ProjectMaintenance } from "./project-state";
import type { ProjectChange } from "./project-changes";
import type { WikiClaim } from "./wiki-claims";
import type { ProjectHistoryAnalysis } from "./project-history";
export type { UnderstandingRelationKind } from "./understanding-relations";

export type FocusMode = "review" | "answer" | "work";

/** Confirmed discussion ranges, separate from the conversations supplying them. */
export interface FocusScopeBlock {
  conversationId: string;
  title: string;
  messageIds: string[];
  messageSignatures: Record<string, string>;
}

export interface FocusScope {
  kind: "goal" | "all";
  /** Confirmed source pool; included evidence may use only part of it. */
  sourceConversationIds?: string[];
  blocks?: FocusScopeBlock[];
  /** Source-grounded interpretation of the user's task, not a new instruction or user confirmation. */
  taskUnderstanding?: string;
}

export interface FocusEvidence {
  id: string;
  conversationId: string;
  messageId: string;
  title: string;
  excerpt: string;
  sourceSignature?: string;
  sourceVersionId?: string;
}

/** AI interpretation with recoverable source provenance, separate from personal edits. */
export interface SemanticConcept {
  key: string;
  title: string;
  description: string;
  layer?: string;
  inputs?: string[];
  outputs?: string[];
  quote: string;
  evidenceIds: string[];
  status: "discussed" | "proposal" | "uncertain" | "superseded";
  basis?: "original" | "summary";
  sectionIds?: string[];
}
export interface SemanticRelation {
  from: string;
  to: string;
  kind: UnderstandingRelationKind;
  label?: string;
  quote: string;
  evidenceIds: string[];
  status: "supported" | "uncertain";
}
export interface SemanticStructure { nodes: SemanticConcept[]; relations: SemanticRelation[] }

export interface FocusSection {
  wikiRevisionReceipt?:WikiRevisionReceipt;
  wikiTitleReview?: WikiTitleReview;
  id: string;
  title: string;
  body: string;
  transition: string;
  evidenceIds: string[];
  kind: "review" | "finding" | "proposal" | "open_question";
  phase?: string;
  /** Optional material-backed Wiki category; separate from discussion chronology. */
  wikiGroup?: string;
  /** Central question of this page, assigned by the global directory audit. */
  wikiQuestion?: string;
  /** Stable editorial owner, independent of the generated display title. */
  wikiOwnerId?:string;
  /** Scope keys of the notes this chapter was written from; leaving the chapter out excludes them. */
  wikiMaterialKeys?:string[];
  /** Optional editorial outline; Markdown remains the canonical readable body. */
  wikiSubtopics?:Array<{title:string;question:string}>;
  /** Preview only: planned chapter shown as key points while its prose is being written. Never saved. */
  wikiOutline?:boolean;
  /** Editorial hints tied to this body, not verification/adoption metadata. */
  writingQuality?:{signature:string;issues:Array<{code:"thin_subtopic"|"result_checklist"|"missing_overview"|"batch_commentary"|"duplicate_heading"|"repeated_explanation"|"dense_outline"|"empty_citation"|"cross_chapter_duplicate";title:string}>};
  wikiGroupEdited?: boolean;
  /** Preserve the generated title for signatures when only the Wiki label changes. */
  wikiOriginalTitle?: string;
  /** User-owned short navigation label. Full article title and source identities stay unchanged. */
  wikiDisplayTitle?: string;
  /** Sentences naming the user's stance that the user kept as their own words (by stance key): no longer flagged. */
  wikiStancesKept?: string[];
  /** User-owned navigation links, never original-message proof. */
  relatedKnowledgeIds?: string[];
  /** Conclusions are projected from the original matter ID, not copied into the article. */
  matterLinks?: Array<{id:string; type:"question"|"decision"|"boundary"; signature:string; linkedAt:number}>;
  /** Placement only; saved graph/notes remain in the existing chapter structure fields. */
  wikiDiagram?: { afterHeading?: string; hidden?: boolean };
  claims?: WikiClaim[];
  /** Review feedback is retained independently of saving or editorial acceptance. */
  reviewIssue?: string;
  /** Keeping prose is an editorial choice, never fact confirmation. Invalidated by content/evidence changes. */
  editorialReview?: { signature: string; keptAt: number };
  /** Bounded evidence review is not a whole-document truth guarantee. */
  evidenceReview?: { mode?: "manual"; status: "unanchored" | "partial" | "anchored" | "verified"; invalidClaims: number; checkedClaims: number; totalClaims: number;
    coverage?: { version: number; signature: string; importantStatements: number; uncoveredStatements: number } };
  /** Local authored cards are personal understanding, not generated historical evidence. */
  origin?: "user";
  userEdited?: boolean;
  /** Local route within this chapter. Kept separately from the project chapter order. */
  understandingPath?: FocusSection[];
  /** Authored local relations; they never become historical source evidence. */
  understandingLinks?: Array<{ targetId: string; kind: UnderstandingRelationKind }>;
  /** Optional personal explanation of the node's responsibility; never source evidence. */
  responsibility?: string;
  /** Personal explanatory prose; never replaces the original evidence. */
  personalExplanation?: string;
  layer?: string;
  inputs?: string[];
  outputs?: string[];
  /** Personal structure edits are separate from changes to generated source text. */
  structureEdited?: boolean;
  semanticStructure?: SemanticStructure;
  semanticBodySignature?: string;
  semanticAnalysisVersion?: number;
  semanticSourceSignature?: string;
}

export interface FocusBrief {
  summary: string;
  turningPoints: Array<{ text: string; evidenceIds: string[] }>;
  confirmed: Array<{ text: string; evidenceIds: string[] }>;
  openQuestions: string[];
}

/** Personal project structure is independent of chapter reading order and generated prose. */
export interface ProjectUnderstandingEdit {
  id: string;
  title: string;
  responsibility: string;
  personalExplanation?: string;
  sectionIds: string[];
  links: Array<{ targetId: string; targetTitle?: string; kind: UnderstandingRelationKind }>;
}
export interface ProjectUnderstandingEdits {
  nodes: ProjectUnderstandingEdit[];
  order: string[];
}

/** Neutral source structure shared by original reading and every goal-based review. */
export interface FocusSourceOutline {
  conversationId: string;
  scope?: "partial";
  messageSignatures?: Record<string, string>;
  messageOrder?: string[];
  messageRoles?: Record<string, string>;
  chapters: Array<{ id: string; title: string; summary: string; messageIds: string[]; phase?: string; transition?: string }>;
}

/** Editorial source routing; originals and neutral reading caches remain intact. */
export interface WikiScopeReview {
  version:1;
  /** Missing on legacy results: an empty proposal list alone does not prove a scope review. */
  status?:"complete"|"incomplete";
  goal:string;
  includeKeys:string[];
  /** Materials the user removed from the Wiki; they are kept out before directory planning. */
  excludeKeys?:string[];
  /** A subset of exclusions, hidden from side material and retained on future updates. Originals are untouched. */
  ignoredKeys?:string[];
  /** keys: every key a whole-chapter exclusion covers; key is the first of them. */
  /** other: proposed side material; uncertain: retained with unconfirmed
   * membership, never a confirmed project requirement. Older versions may have
   * omitted uncertain material; restoring it still requires a writing preview. */
  materials:Array<{id:string;key:string;keys?:string[];title:string;body:string;evidenceIds:string[];kind:"reference"|"other"|"uncertain";reason:string;quote:string;userExcluded?:true}>;
  /** Retained in prose without a completed membership decision. These are not
   * AI-proposed exclusions; the reader can explicitly include or leave them out. */
  unreviewed?:Array<{id:string;key:string;title:string;body:string;evidenceIds:string[];reason:"missing_receipt"|"context_omitted"|"invalid_receipt"}>;
}
/** A goal and its result exist independently of a long-term Knowledge Space. */
export interface WikiTitleReview {version:2;policyVersion?:3;status:"ready"|"partial"|"failed"|"skipped";requested:number;accepted:number;rejected:Array<{id:string;reason:string}>}
export interface WikiRevisionReceipt {version:1;basisSessionId:string;batches:number;cachedBatches:number;draftUnits:number;sourceUnits:number;/** Draft units kept exactly as saved because even alone they exceed one request. */keptDraftUnits?:number;references:Array<{conversationId:string;messageId:string;start:number;end:number;evidenceIds:string[];excerpt:string;reason:string}>}
export interface FocusSession {
  wikiRevisionReceipt?:WikiRevisionReceipt;
  /** Explicit content revision preview; navigation metadata, never source proof. */
  wikiContentReview?:{version:1;basisSessionId:string;moves:Array<{fromId:string;topicTitle:string;toId:string}>};
  wikiTitleReview?:WikiTitleReview;
  /** A candidate for explicit renaming, never an override of a saved project name. */
  wikiSuggestedTitle?:string;
  /** Stable saved identity used when updating or restoring project materials. */
  wikiProjectBoundary?:import("./wiki-project-boundary").WikiProjectBoundary;
  /** Explicit updates backfill project-scoped paragraph routing once. */
  wikiMainlineVersion?:1;
  wikiScopeReview?:WikiScopeReview;
  /** Overview is projected locally from the same saved Wiki knowledge. */
  knowledgeViewVersion?:1;
  id: string;
  /** Completed generations are recoverable before the user accepts a new version. */
  status?: "preview" | "ready";
  /** A developer test of the knowledge-unit ledger, its conversations picked directly: no document, hidden from
   * every document list, sidebar and scope; listed only in the developer ledger panel. */
  ledgerTest?: true;
  /** A deleted version of a project: hidden everywhere, restorable from Trash. */
  deletedAt?: number;
  /** Removed from Workbench history only; the saved document and its versions remain available. */
  historyHiddenAt?: number;
  goal: string;
  runId?: string;
  strategy?: "answer" | "review" | "work";
  mode: FocusMode;
  /** Language of the generated result; legacy saved results may omit it. */
  locale?: "zh-CN" | "en";
  title: string;
  sourceConversationIds: string[];
  /** Explicit sidebar associations awaiting a user-requested project update. */
  sidecarConversationIds?: string[];
  scope?: FocusScope;
  evidence: FocusEvidence[];
  coverage?: { method: "full_direct" | "full_batched" | "sampled"; sourceCount: number; processedSegments: number; totalSegments: number; sourceCharacters?: number; batchCount?: number; elapsedMs?: number };
  sections: FocusSection[];
  brief?: FocusBrief;
  briefUserEdited?: boolean;
  /** Generated document overview, valid only while its chapters keep this signature; otherwise the local projection is used. */
  wikiOverview?: {version:1;text:string;signature:string;evidenceIds:string[]};
  projectUnderstanding?: ProjectUnderstandingEdits;
  semanticOverview?: SemanticStructure;
  projectState?: ProjectState;
  /** Reusable derived first-reading facts, separate from original messages. */
  projectKnowledge?: import("./project-knowledge").ProjectKnowledge;
  projectChanges?: ProjectChange[];
  projectMaintenance?: ProjectMaintenance;
  wikiOrder?: string[];
  wikiSectionAliases?: Record<string,string>;
  /** Editorial organization receipt, never a fact-verification result. */
  wikiOrganization?: {version:1|2|3|4|5|6;status:"organized"|"deferred"|"unchanged"|"protected";signature:string;mergedSections:number;reason?:string;pendingSectionIds?:string[];inputSections?:number;protectedSections?:number;plannedChapters?:number;finalSections?:number};
  /** Current-edition writing policy; older projects rebuild only on explicit update. */
  wikiEdition?:"current-v1"|"current-v2";
  /** Explanation ownership, block checks and repair semantics this document was
   * produced with. Separate from wikiEdition (organization) and writing versions. */
  wikiSemanticVersion?:number;
  /** Knowledge-unit ledger from the developer switch (redesign P1); not read into the document. */
  wikiKnowledge?:import("./wiki-knowledge").WikiKnowledgeLedger;
  /** Located problems left after the bounded repair, for review and later updates. */
  wikiQuality?:{version:1;signature:string;issues:import("./wiki-explanations").WikiBlockIssue[];merged:number;repaired:number;requests:number};
  /** What the document can claim about its own checks; computed, never model-declared. */
  wikiVerification?:import("./wiki-explanations").WikiVerification;
  wikiMergeHistory?: Array<{at:number;sections:FocusSection[];sectionNotes?:FocusSession["sectionNotes"];wikiOrder?:string[]}>;
  wikiDirectoryReview?: { status: "ready" | "pending"; reason?: "budget" | "analysis" };
  wikiGroups?: string[];
  wikiCollapsedGroups?: Record<string, boolean>;
  /** Proposed replacements of personal pages remain separate until explicitly edited. */
  wikiSuggestions?: Record<string, FocusSection>;
  projectStateAnalysis?: { status: "ready" | "failed"; error?: string; cache?: { reusedRequests: number; bypassed: boolean } };
  structureAnalysis?: { status: "pending" | "ready" | "partial" | "failed"; version: number; modelKey?: string; updatedAt?: number };
  sourceOutlines?: FocusSourceOutline[];
  activeSectionId: string;
  completedSectionIds: string[];
  reviewNeeds?: Record<string, string>;
  visitedSectionIds?: string[];
  notes: string;
  sectionNotes?: Record<string, { text: string; title?: string; module?: { id: string; title: string }; evidenceIds: string[]; sources?: FocusEvidence[]; updatedAt: number; deletedAt?: number }>;
  detachedNotes?: Array<{ title: string; text: string; module?: { id: string; title: string }; section?: { id: string; title: string }; sources?: FocusEvidence[]; origin?: "query"; deletedAt?: number; /** Identifies a preserved legacy understanding record now maintained as a note. */ understandingNoteId?: string }>;
  sourceSignatures?: Record<string, Record<string, string>>;
  sourceVersionIds?: Record<string, string>;
  projectHistoryScan?: { scannedMessages: number; candidateMessages: number; includedMessages: number };
  projectHistoryAnalysis?: ProjectHistoryAnalysis;
  projectEvolutionAnalysis?: ProjectHistoryAnalysis;
  projectEvolutionStatus?: {status:"ready"|"failed"|"partial";error?:string};
  projectHistoryStatus?: { status: "ready" | "failed" | "partial"; error?: string };
  sourceMessageOrder?: Record<string, string[]>;
  sourceRoles?: Record<string, Record<string, string>>;
  canvasId?: string;
  /** Revisions stay recoverable, but share one entry in Continue reading. */
  rootSessionId?: string;
  previousSessionId?: string;
  createdAt: number;
  updatedAt: number;
}
