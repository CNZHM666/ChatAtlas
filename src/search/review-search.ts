import type { Conversation, ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { getDatabase } from "../storage/db";
import { getMessagesForConversation } from "../storage/messages";
import { messageFullTextSearch } from "./message-fulltext";
import { readerQuestionIndex } from "../canvas/reader-position";
import { searchExcerpt, searchScore } from "./query";
import { semanticDocuments, searchSemanticArtifacts, searchCachedVectors } from "./semantic-index";
import { resolveEmbeddingProvider } from "../ai/embedding-provider";
import { hasProviderPermission } from "../ai/provider";
import type { SearchResult } from "./search-index";

/** Answer hits retain the actual matching message; Reader restores its complete question chain. */
export async function searchAnswers(query: string, conversations: Conversation[]): Promise<SearchResult[]> {
  const found = await messageFullTextSearch.search(query, { limit: 100 });
  const matches = found.hits.map(hit => hit.message);
  const groups = new Map<string, ConversationMessage[]>();
  await Promise.all([...new Set(matches.map((message) => message.conversationId))].map(async (id) => groups.set(id, await getMessagesForConversation(id))));
  const results = new Map<string, SearchResult>();
  for (const hit of found.hits) {
    const message = hit.message;
    const ordered = groups.get(message.conversationId) ?? [];
    const questionId = readerQuestionIndex(ordered).get(message.id);
    const question = ordered.find(item => item.id === questionId);
    const key = `${message.conversationId}:${question?.id ?? message.id}`;
    const result: SearchResult = { kind: "message", id: message.id, title: question?.preview || question?.content.slice(0, 120) || message.preview, context: conversations.find((item) => item.id === message.conversationId)?.title ?? "", excerpt: hit.summary, sourceRange: hit.sourceRange, score: searchScore(query, message.content, true) || hit.score, message, questionId: question?.id };
    const previous = results.get(key);
    if (!previous || previous.score < result.score || previous.score === result.score && message.role === "assistant") results.set(key, result);
  }
  return [...results.values()].sort((a, b) => b.score - a.score || Number(b.kind === "message" && b.message.role === "assistant") - Number(a.kind === "message" && a.message.role === "assistant"));
}

export function searchReviewSections(query: string, sessions: FocusSession[], related = true): SearchResult[] {
  return sessions.flatMap((session) => session.sections.flatMap((section): SearchResult[] => {
    const note = session.sectionNotes?.[section.id]?.deletedAt ? undefined : session.sectionNotes?.[section.id]?.text;
    const question = session.reviewNeeds?.[section.id];
    const notes = [note, question].filter(Boolean).join(" ");
    const noteScore = notes ? searchScore(query, notes, related) : 0;
    const score = searchScore(query, `${section.title} ${section.body} ${section.transition}`, related);
    return [
      ...(noteScore ? [{ kind: "note" as const, id: `${session.id}:${section.id}:note`, sessionId: session.id, sectionId: section.id, title: section.title, context: session.title, excerpt: searchExcerpt(query, notes), score: noteScore + 8 }] : []),
      ...(score ? [{ kind: "section" as const, id: `${session.id}:${section.id}`, sessionId: session.id, sectionId: section.id, title: section.title, context: session.title, excerpt: searchExcerpt(query, section.body), score }] : []),
    ];
  })).sort((a, b) => b.score - a.score).slice(0, 25);
}

/** Related lookup reuses grounded summaries locally, without generating another answer. */
export async function searchRelatedDiscussions(query: string, conversations: Conversation[], options: { semantic?: boolean } = {}): Promise<SearchResult[]> {
  const db = await getDatabase();
  const [profiles, graphs] = await Promise.all([db.getAll("semanticProfiles"), db.getAll("conversationGraphs")]);
  const documents = semanticDocuments(conversations, profiles, graphs);
  const lexical = await searchSemanticArtifacts(query, documents, 12, null);
  const settings = options.semantic ? await db.get("aiSettings", "ai-settings") : undefined;
  const embedding = settings?.embeddingModel && await hasProviderPermission(settings.baseUrl) ? await resolveEmbeddingProvider(settings) : null;
  const vectors = embedding ? await searchCachedVectors(query, documents, embedding).catch(() => []) : [];
  const ranking = new Map<string, { hit: (typeof lexical)[number]; score: number }>();
  for (const list of [lexical, vectors]) list.forEach((hit, i) => { const prev = ranking.get(hit.documentId); ranking.set(hit.documentId, { hit, score: (prev?.score ?? 0) + 1 / (61 + i) }); });
  const hits = [...ranking.values()].sort((a, b) => b.score - a.score).slice(0, 12).map(row => row.hit);
  return Promise.all(hits.map(async (hit): Promise<SearchResult> => {
    const episode = graphs.find((graph) => graph.conversationId === hit.conversationId)?.episodes?.find((item) => item.id === hit.episodeId);
    const messages = episode ? await getMessagesForConversation(hit.conversationId) : [];
    const message = messages.find((item) => item.id === episode?.messageIds[0]);
    const questionId = message ? messages.slice(0, messages.indexOf(message) + 1).reverse().find((item) => item.role === "user")?.id : undefined;
    const document = documents.find((item) => item.id === hit.documentId)!;
    const context = conversations.find((item) => item.id === hit.conversationId)?.title ?? "";
    return message ? { kind: "message", id: message.id, message, questionId, title: document.title, context, excerpt: searchExcerpt(query, document.body), score: 15 + hit.score } : { kind: "conversation", id: hit.conversationId, title: context, context: document.body, score: 12 + hit.score };
  }));
}
