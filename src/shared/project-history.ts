import type { FocusEvidence, FocusSession } from "./focus-session";
import type { ProjectHistoryEvent, ProjectSource } from "./project-state";
import { sourceMessageSignature } from "./source-signature";
import type { ConversationMessage } from "./types";
import { historyScopeMessages } from "./product-version-candidates";

export interface ProjectHistoryAnalysis {
  /** Extraction and verification policy; absent on retained legacy histories. */
  evolutionPolicyVersion?: number;
  /** Language of generated presentation only; original quotations are never translated. */
  presentationLocale?: string;
  /** Explicitly reviewed generated-text translations, never user edits or state changes. */
  presentationChanges?: string[];
  pendingLanguageRecords?: number;
  sourceManifest?: import("./evolution-source-plan").EvolutionSourceManifest;
  sourceDelta?: {added:number;changed:number;removed:number;affectedEventIds:string[]};
  /** Candidate coverage is distinct from successful extraction coverage. */
  unselectedMessages?: number;
  /** Stable source-only plan for continuation; no duplicated historical text. */
  extractionPlan?: {version:1;policyKey:string;sourceSignature:string;groups:Array<Array<{conversationId:string;messageId:string;signature:string;contextSignature:string;start:number;end:number;partial?:boolean}>>};
  continuation?: {completedSegments:number;totalSegments:number;remainingSegments:number};
  roundDelta?: {newEventIds:string[];evidenceEventIds:string[];retainedEvents:number};
  usage?: {rounds:number;newRequests:number;reusedRequests:number;estimatedInputTokens:number;totalRequests:number;totalEstimatedInputTokens:number};
  kind?: "releases" | "evolution";
  version: 1 | 2 | 3 | 4 | 5 | 6;
  signature: string;
  sourceSignature: string;
  events: ProjectHistoryEvent[];
  evidence: FocusEvidence[];
  sources: ProjectSource[];
  generatedAt: number;
  /** Independent failed extraction batches; retained facts are still readable. */
  pendingBatches?: number;
  pendingFields?: number;
  pauseReason?: "budget" | "verification";
  /** Explicit extraction coverage; old facts alone never imply whole-message coverage. */
  examinedSpans?: Array<{ conversationId: string; messageId: string; signature: string; contextSignature: string; start: number; end: number }>;
  extractionPolicyKey?: string;
  candidateVersion?: number;
  resolutionVersion?: 1;
  updateSetId?: string;
  baseRevision?: string;
  appliedOperations?: string[];
  matches?: Array<{ eventId: string; targetId: string; kind: "duplicate" | "related"; basis: "literal" | "model"; sameSubject?:boolean }>;
  /** Extraction checkpoint only; never displayed/adopted as verified knowledge. */
  checkpointEvents?: ProjectHistoryEvent[];
  review?: { omittedEvents: number; omittedDetails: number };
  coverage?: { scopedMessages: number; examinedMessages: number; partialMessages: number };
}
export function projectHistorySourceSignature(session: FocusSession, messages: ConversationMessage[]) {
  return sourceMessageSignature(JSON.stringify(session.sourceConversationIds.flatMap(id => historyScopeMessages(session, id, messages)).map(message => [message.conversationId, message.id, message.role, message.messageIndex, message.createdAt, sourceMessageSignature(message.content)])));
}
/** Wiki edits do not change the original discussion history. Scope/roles/order do. */
export function projectHistorySignature(session: FocusSession) {
  return sourceMessageSignature(JSON.stringify([session.goal, session.sourceConversationIds, session.scope, session.sourceVersionIds, session.sourceSignatures, session.sourceRoles, session.sourceMessageOrder, session.sourceOutlines?.map(outline => [outline.conversationId, outline.messageSignatures, outline.messageOrder, outline.chapters.map(chapter => chapter.messageIds)])]));
}
