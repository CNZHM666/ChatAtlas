import type { FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { ProjectFactStatus } from "../shared/project-fact-state";

export type ContextSectionKind = "overview" | "decisions" | "progress" | "next" | "history" | "wiki" | "evidence";
export type ContextLength = "short" | "standard" | "detailed";
export type ContextStatus = ProjectFactStatus;
export interface TaskRequirements {constraints:string;acceptance:string}
export interface ContextOptions { zh: boolean; task: string; length: ContextLength; sections: ContextSectionKind[]; mode?:"quick"|"task"|"full";tokenBudget?:number; basis?:"saved"; wikiSectionIds?:string[];requirements?:TaskRequirements }
export const savedContextSections:ContextSectionKind[]=["overview","wiki","decisions","progress","next"];
export const defaultContextSections: ContextSectionKind[] = ["overview", "decisions", "progress"];
export const taskContextSections: ContextSectionKind[] = ["overview", "decisions", "progress", "next", "wiki", "history"];
export const contextBudgets: Record<ContextLength, number> = { short: 1400, standard: 3600, detailed: 7600 };
// Selection depth is independent of the maximum token budget.
export const contextProfiles = {
  short: { limits: { overview: 1, decisions: 4, progress: 2, next: 2, history: 1, wiki: 2, evidence: 1 }, modules: 1, relations: 0, wikiPages: 1 },
  standard: { limits: { overview: 2, decisions: 12, progress: 5, next: 5, history: 4, wiki: 8, evidence: 4 }, modules: 4, relations: 2, wikiPages: 3 },
  detailed: { limits: { overview: 2, decisions: 40, progress: 12, next: 12, history: 12, wiki: 24, evidence: 10 }, modules: 16, relations: 8, wikiPages: 8 },
} satisfies Record<ContextLength, { limits: Record<ContextSectionKind, number>; modules: number; relations: number; wikiPages: number }>;
export interface ContextSource {
  id: string; evidenceIds: string[]; conversationId: string; messageId: string;
  title: string; signature: string; updatedAt: number; role: "user" | "assistant"; url?: string;
  question?: string;
  /** Original order within this conversation; not a cross-conversation clock. */
  messageIndex?: number;
  /** Literal slices of validated originals; never populated from generated prose. */
  excerpts?: string[];
  /** A complete, suitably small prose window was unavailable; original stays local. */
  excerptOmitted?: boolean;
}
export interface ContextItem { id: string; text: string; status: ContextStatus; sourceIds: string[]; referenceIds?:string[]; updatedAt: number; quotes?: Array<{sourceId:string; text:string}>; currency?:"unreviewed"; confirmationBasis?:"atlas"; scope?:"task"|"phase"; literal?:boolean }
export interface ContextCapability { title:string;status:ContextStatus;sourceIds:string[];currency?:"unreviewed" }
export interface ContextOmissions { unsupported:number; duplicate:number; relevance:number; depth:number; budget:number; disabled:number }
export interface ContextSection { kind: ContextSectionKind; items: ContextItem[] }
export interface ContextSelectionCount { available: number; matching: number; included: number }
export interface ContextBundle {
  requirements?:TaskRequirements;
  schemaVersion: 1; id: string; projectId: string; projectName: string; task: string; generatedAt: number;
  locale: "zh-CN" | "en"; sections: ContextSection[]; sources: ContextSource[];
  knowledgeSignature: string; tokenBudget: number; estimatedTokens: number; tokenCountKind: "estimate";
  basis?: "saved";
  knowledgeUpdatedAt?:number;
  purpose?: "overview" | "task";
  length?: ContextLength;
  requestedSections?: ContextSectionKind[];
  taskEvidenceMatched?: boolean;
  selection: Record<ContextSectionKind, ContextSelectionCount>;
  omissions?: ContextOmissions;
  capabilities?:ContextCapability[];
  omittedItems: number; invalidSources: number; supersededItems: number; sourcesStale: boolean;
}
export interface ProjectKnowledge {
  session: FocusSession; conversations: Conversation[]; messages: ConversationMessage[];
  sourcesStale: boolean; signature: string;
}
