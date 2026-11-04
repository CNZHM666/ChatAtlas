import type { ConversationSemanticProfile, KnowledgeCard, QuestionSnapshot } from "../shared/types";
import { stableId } from "./canvas-planner";
import { canonicalConceptTitle, conceptKey } from "./concept-canonicalizer";

const ignored = /^(今天|继续|代码|问题|其他|帮助|对话|讨论|内容|things?|question|code)$/i;

export function extractConcepts(profiles: ConversationSemanticProfile[], now = Date.now(), snapshots: QuestionSnapshot[] = []): KnowledgeCard[] {
  const names = [...new Set(profiles.flatMap((profile) => profile.concepts.map((concept) => concept.trim())).filter((concept) => concept.length >= 2 && concept.length <= 42 && !ignored.test(concept)))];
  return names.map((title) => ({
    id: stableId("concept-ai", title), type: "concept", title, body: undefined, tags: [],
    evidenceRefs: snapshots.filter((snapshot) => profiles.some((profile) => profile.conversationId === snapshot.conversationId && profile.concepts.some((concept) => conceptKey(concept) === conceptKey(title))) && snapshot.concepts.some((concept) => conceptKey(canonicalConceptTitle(concept)) === conceptKey(canonicalConceptTitle(title)))).slice(0, 4).map((snapshot) => ({ conversationId: snapshot.conversationId, questionId: snapshot.questionId, messageId: snapshot.questionId })),
    origin: "ai", userEdited: false, createdAt: now, updatedAt: now,
  }));
}
