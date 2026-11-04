import type { Conversation, ConversationGraph, ConversationMessage, QuestionSnapshot } from "./types";

export interface NavigatorQuestion {
  id: string;
  title: string;
  memberMessageIndices?: number[];
  message: Pick<ConversationMessage, "platformMessageId" | "contentHash" | "preview" | "messageIndex" | "role"> & { textLength: number };
}

export interface NavigatorChapter {
  id: string;
  title: string;
  questionCount?: number;
  questions: NavigatorQuestion[];
}

export interface NavigatorData {
  conversationId: string;
  title: string;
  updatedAt: number;
  chapters: NavigatorChapter[];
  allQuestions: NavigatorQuestion[];
}

export interface NavigatorDataResponse {
  ok: boolean;
  data?: NavigatorData;
  error?: string;
}

function conciseTitle(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return [...normalized].length > 28 ? `${[...normalized].slice(0, 27).join("")}…` : normalized;
}

/** A read-only projection of the exact graph used by Conversation Canvas. */
export function buildNavigatorData(conversationId: string, graph?: ConversationGraph, conversation?: Conversation, messages: ConversationMessage[] = [], snapshots: QuestionSnapshot[] = []): NavigatorData {
  const nodes = new Map(graph?.nodes.map((node) => [node.id, node]));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.questionId, snapshot]));
  const nodeByMessageId = new Map((graph?.nodes ?? []).filter((node) => node.kind === "question" && node.sourceMessageId).map((node) => [node.sourceMessageId!, node]));
  const project = (message: ConversationMessage, id = `conversation-message-${message.id}`, title?: string): NavigatorQuestion => ({
    id, title: conciseTitle(title || (nodeByMessageId.get(message.id)?.displayTitleSource !== "fallback" ? nodeByMessageId.get(message.id)?.displayTitle : undefined) || snapshotById.get(message.id)?.displayTitle || nodeByMessageId.get(message.id)?.displayTitle || nodeByMessageId.get(message.id)?.title || message.preview || message.content) || "Untitled question",
    message: { platformMessageId: message.platformMessageId, contentHash: message.contentHash, preview: message.preview, messageIndex: message.messageIndex, role: message.role, textLength: message.content.length },
  });
  const allQuestions = messages.filter((message) => message.role === "user").sort((a, b) => a.messageIndex - b.messageIndex).map((message) => project(message));
  return {
    conversationId,
    title: conversation?.title || graph?.nodes.find((node) => node.kind === "conversation-root")?.title || "当前对话",
    updatedAt: graph?.updatedAt ?? 0,
    chapters: [...(graph?.chapters ?? [])].sort((a, b) => a.order - b.order).map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      questionCount: chapter.questionIds.length,
      questions: chapter.questionIds.flatMap((id) => {
        const node = nodes.get(id);
        const message = node?.sourceMessageId ? byId.get(node.sourceMessageId) : undefined;
        if (!node || !message || message.role !== "user") return [];
        return [project(message, id)];
      }),
    })).map((chapter) => {
      const episodes = (graph?.episodes ?? []).filter((episode) => episode.chapterId === chapter.id);
      if (!episodes.length) return chapter;
      const used = new Set<string>();
      const grouped = episodes.flatMap((episode) => {
        const members = episode.questionIds.flatMap((id) => chapter.questions.filter((question) => question.id === id));
        if (!members.length) return [];
        members.forEach((question) => used.add(question.id));
        return [{ ...members[0], id: episode.id, title: conciseTitle(episode.title), memberMessageIndices: members.map((question) => question.message.messageIndex) }];
      });
      return { ...chapter, questions: [...grouped, ...chapter.questions.filter((question) => !used.has(question.id))].sort((a, b) => a.message.messageIndex - b.message.messageIndex) };
    }),
    allQuestions,
  };
}
