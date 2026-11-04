import type { Conversation, ConversationMessage, ConversationSemanticProfile, QuestionSnapshot } from "../shared/types";
import { getDatabase } from "../storage/db";
import { ANALYSIS_VERSION, analyzedVersion } from "./conversation-profiler";
import { dependsOnEarlierContext } from "./episode-candidates";
import { localSnapshot } from "./semantic-analysis";
import { indexAnswersByQuestion } from "../canvas/conversation-graph";

export function completeQuestionMaterials(messages: ConversationMessage[], now: number) {
  const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
  const answers = indexAnswersByQuestion(ordered);
  return ordered.flatMap((question, index) => {
    if (question.role !== "user") return [];
    const parts = answers.get(question.id) ?? [];
    const answer = parts[0] ? { ...parts[0], content: parts.map((part) => part.content).join("\n"), contentHash: parts.map((part) => part.contentHash).join(":") } : undefined;
    const snapshot = localSnapshot(question, answer, now);
    if (dependsOnEarlierContext(question.content)) snapshot.sourceHash += `:${ordered.slice(Math.max(0, index - 2), index).map((message) => message.contentHash).join(":")}`;
    return [{ snapshot, payload: { conversationId: question.conversationId, questionId: question.id, question: question.content, answer: answer?.content ?? "" } }];
  });
}

export function overviewFromPlan(value: unknown, conversation: Conversation, snapshots: QuestionSnapshot[], modelKey: string, mode: "fast" | "balanced" | "deep", now: number): ConversationSemanticProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.summary !== "string" || !raw.summary.trim()) return undefined;
  const strings = (key: string, limit: number) => Array.isArray(raw[key]) ? [...new Set((raw[key] as unknown[]).filter((item): item is string => typeof item === "string" && Boolean(item.trim())))].slice(0, limit) : [];
  return { conversationId: conversation.id, title: conversation.title, summary: raw.summary.trim().slice(0, 500), concepts: strings("concepts", 12), domains: strings("domains", 3), topics: strings("topics", 6), intent: typeof raw.intent === "string" ? raw.intent.slice(0, 80) : "", questionCount: snapshots.length, evidenceRefs: snapshots.filter((_, index) => index === 0 || index === snapshots.length - 1 || index === Math.floor(snapshots.length / 2)).map((snapshot) => ({ conversationId: conversation.id, questionId: snapshot.questionId, messageId: snapshot.questionId })), analysisVersion: ANALYSIS_VERSION, analyzedVersion: analyzedVersion(conversation), analysisSource: "ai", analysisModelKey: modelKey, analysisMode: mode, coverage: snapshots.every((snapshot) => snapshot.analysisSource === "ai") ? "complete" : "sampled", updatedAt: now };
}

export async function saveConversationMaterials(snapshots: QuestionSnapshot[], profile?: ConversationSemanticProfile) {
  const tx = (await getDatabase()).transaction(["questionSnapshots", "semanticProfiles"], "readwrite");
  for (const snapshot of snapshots) await tx.objectStore("questionSnapshots").put(snapshot);
  if (profile) await tx.objectStore("semanticProfiles").put(profile);
  await tx.done;
}
