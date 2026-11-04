import { create, insert, remove, search } from "@orama/orama";
import type { Conversation, ConversationGraph, ConversationSemanticProfile, ConversationMessage } from "../shared/types";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";
import { getDatabase } from "../storage/db";
import { resolveEmbeddingProvider, type EmbeddingProvider } from "../ai/embedding-provider";
import { aiMode, effectiveAISettings } from "../ai/ai-mode";
import { hasProviderPermission } from "../ai/provider";
import { estimateTokens } from "../shared/atlas/policy.js";
import type { FocusSession } from "../shared/focus-session";

export interface SemanticHit { documentId: string; conversationId: string; episodeId?: string; score: number }
export interface SemanticSearchOptions { signal?: AbortSignal; allowNewModel?: boolean; vectorDocuments?: SemanticDocument[]; onVectorProgress?: (completed: number, total: number) => void; onVectorUnavailable?: () => void }

const schema = { id: "string", conversationId: "string", episodeId: "string", title: "string", body: "string", terms: "string" } as const;
export type SemanticDocument = { id: string; conversationId: string; episodeId: string; title: string; body: string; terms: string };
type Document = SemanticDocument;
const tokenizer = {
  language: "atlas",
  normalizationCache: new Map<string, string>(),
  tokenize: (raw: string) => raw.toLocaleLowerCase().normalize("NFKC").match(/[a-z0-9+#._-]+|[\p{Script=Han}]+/gu) ?? [],
};
const index = create({ schema, components: { tokenizer } });
const fingerprints = new Map<string, string>();
function createVectorState(dimension: number, modelKey: string) {
  return { modelKey, dimension, index: create({ schema: { ...schema, embedding: `vector[${dimension}]` as `vector[${number}]` }, components: { tokenizer } }), fingerprints: new Map<string, string>() };
}
let vectorState: ReturnType<typeof createVectorState> | null = null;

/** Index short, durable semantic artifacts. Raw messages remain in IndexedDB as reading evidence. */
export function semanticDocuments(conversations: Conversation[], profiles: ConversationSemanticProfile[], graphs: ConversationGraph[]): Document[] {
  const conversationById = new Map(conversations.map((item) => [item.id, item]));
  const documents: Document[] = [];
  const profiled = new Set<string>();
  for (const profile of profiles) {
    const conversation = conversationById.get(profile.conversationId);
    if (!conversation) continue;
    profiled.add(conversation.id);
    const title = profile.title || conversation.title;
    const body = [profile.summary, ...profile.concepts, ...profile.domains, ...profile.topics].join(" ");
    documents.push({ id: `profile:${conversation.id}`, conversationId: conversation.id, episodeId: "", title, body, terms: searchTerms(`${title} ${body}`) });
  }
  for (const conversation of conversations) if (!profiled.has(conversation.id)) documents.push({ id: `conversation:${conversation.id}`, conversationId: conversation.id, episodeId: "", title: conversation.title, body: conversation.summary ?? "", terms: searchTerms(`${conversation.title} ${conversation.summary ?? ""}`) });
  for (const graph of graphs) {
    if (!conversationById.has(graph.conversationId)) continue;
    for (const episode of graph.episodes ?? []) {
      const title = episode.title;
      const body = [episode.summary ?? "", ...(episode.concepts ?? []), episode.contextHeader ?? "", graph.chapters?.find((chapter) => chapter.id === episode.chapterId)?.title ?? ""].join(" ");
      documents.push({ id: `episode:${graph.conversationId}:${episode.id}`, conversationId: graph.conversationId, episodeId: episode.id, title, body, terms: searchTerms(`${title} ${body}`) });
    }
  }
  return documents;
}

/** Keep technical tokens intact and add Han bigrams so short Chinese intents can match. */
export function searchTerms(value: string): string {
  const words = value.toLocaleLowerCase().normalize("NFKC").match(/[a-z0-9+#._-]+|[\p{Script=Han}]+/gu) ?? [];
  return words.flatMap((word) => /^[\p{Script=Han}]+$/u.test(word) ? [...word].slice(0, -1).map((_, index) => word.slice(index, index + 2)) : [word]).join(" ");
}

function textHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(36);
}

const vectorText = (document: Document) => `${document.title} ${document.body}`.slice(0, 2200);
export const semanticDocumentFingerprint=(document:SemanticDocument)=>textHash(vectorText(document));

/** Optional query embeddings must not hold a local lookup behind a slow provider. */
async function cachedQueryEmbedding(query: string, embedding: EmbeddingProvider, signal?: AbortSignal): Promise<number[]> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const error = new DOMException("Optional semantic lookup timed out", "TimeoutError"); controller.abort(error); reject(error); }, 8000);
  });
  try { return await Promise.race([embedding.embedText(query, controller.signal), deadline]); }
  finally { clearTimeout(timer!); signal?.removeEventListener("abort", cancel); }
}

/** The same raw windows are used by background indexing and scope-bound query retrieval. */
export function rawSemanticDocuments(messages: Array<Pick<ConversationMessage, "id" | "conversationId" | "content">>): SemanticDocument[] {
  return messages.flatMap(message => {
    const docs: SemanticDocument[] = [];
    for (let start = 0; start < message.content.length; start += 1800) {
      const body = message.content.slice(start, start + 2000);
      docs.push({ id: `passage:${message.conversationId}:${message.id}:${start}`, conversationId: message.conversationId, episodeId: "", title: "", body, terms: searchTerms(body) });
    }
    return docs;
  });
}

/** Shared query cache across sidebar and workspace. No historical text is embedded here. */
export async function semanticQueryVector(query: string, embedding: EmbeddingProvider, dimension: number, signal?: AbortSignal): Promise<number[]> {
  const db = await getDatabase(), normalized = query.trim().normalize("NFKC").toLocaleLowerCase();
  const id = `${embedding.modelKey}:query:${textHash(normalized)}`, cached = await db.get("semanticVectors", id);
  if (cached?.textHash === normalized && cached.values.length === dimension && cached.values.every(Number.isFinite)) return cached.values;
  const vector = await cachedQueryEmbedding(query, embedding, signal); signal?.throwIfAborted();
  if (vector.length !== dimension || !vector.every(Number.isFinite)) throw new Error("Embedding dimensions do not match the saved index.");
  await db.put("semanticVectors", { id, modelKey: embedding.modelKey, textHash: normalized, values: vector, updatedAt: Date.now() });
  const queries = (await db.getAll("semanticVectors")).filter(item => item.id.includes(":query:")).sort((a,b) => b.updatedAt-a.updatedAt);
  for (const row of queries.slice(50)) await db.delete("semanticVectors", row.id);
  return vector;
}

/** Never builds vectors on the query path. Cache absence keeps local search usable. */
export async function searchCachedVectors(query: string, documents: SemanticDocument[], embedding: EmbeddingProvider, signal?: AbortSignal, limit = 12): Promise<SemanticHit[]> {
  signal?.throwIfAborted();
  const db = await getDatabase();
  const saved = new Map((await db.getAll("semanticVectors")).filter(item => item.modelKey === embedding.modelKey).map(item => [item.id, item]));
  const candidates = documents.flatMap(document => {
    const row = saved.get(`${embedding.modelKey}:${document.id}`);
    return row?.textHash === textHash(vectorText(document)) ? [{ document, values: row.values }] : [];
  });
  if (!candidates.length) return [];
  const dimension = candidates[0].values.length;
  const vector = await semanticQueryVector(query, embedding, dimension, signal);
  signal?.throwIfAborted();
  if (vector.length !== dimension) return [];
  const cosine = (values: number[]) => {
    if (values.length !== dimension) return 0;
    let dot = 0, a = 0, b = 0;
    for (let i = 0; i < dimension; i++) { dot += vector[i] * values[i]; a += vector[i] ** 2; b += values[i] ** 2; }
    return a && b ? dot / Math.sqrt(a * b) : 0;
  };
  return candidates.map(({ document, values }) => ({ documentId: document.id, conversationId: document.conversationId, ...(document.episodeId ? { episodeId: document.episodeId } : {}), score: cosine(values) })).filter(hit => hit.score >= .55).sort((a, b) => b.score - a.score).slice(0, limit);
}
let vectorUpdateTail = Promise.resolve();

/** Explicit user action: incrementally index at most 32 raw windows, with resumable hashes. */
export async function prepareMessageVectors(conversationIds: string[], options: { signal?: AbortSignal; from?: number; to?: number; onProgress?: (completed: number, total: number) => void } = {}) {
  const db = await getDatabase(), settings = effectiveAISettings(await db.get("aiSettings", "ai-settings"));
  const ids = [...new Set(conversationIds)];
  const provider = await resolveEmbeddingProvider(settings, options.signal, `sidecar-index-${crypto.randomUUID()}`, ids);
  if (!provider) throw new Error("EMBEDDING_NOT_CONFIGURED");
  if (!await hasProviderPermission(settings.baseUrl)) throw new Error("EMBEDDING_PERMISSION_REQUIRED");
  const messages: ConversationMessage[] = [];
  for (const id of ids) {
    options.signal?.throwIfAborted(); if (!await db.get("conversations", id)) continue;
    const rows = await db.getAllFromIndex("messages", "by-conversation", id);
    messages.push(...rows.filter(row => row.content.trim() && !isInternalSearchQueryMessage(row) && (options.from === undefined || row.createdAt >= options.from) && (options.to === undefined || row.createdAt <= options.to)));
  }
  const documents = rawSemanticDocuments(messages);
  await updateSemanticVectors(documents, provider, 32, false, { signal: options.signal, allowNewModel: true, onVectorProgress: options.onProgress });
  options.signal?.throwIfAborted();
  const saved = new Map((await db.getAll("semanticVectors")).map(row => [row.id, row]));
  const indexed = documents.filter(document => saved.get(`${provider.modelKey}:${document.id}`)?.textHash === semanticDocumentFingerprint(document)).length;
  return { indexed, total: documents.length, remaining: documents.length-indexed };
}

/** Update only changed documents; searches may limit foreground work while applied proposals refresh in the background. */
async function updateSemanticVectors(documents: Document[], embedding: EmbeddingProvider, limit = Infinity, rebuild = false, options: SemanticSearchOptions = {}) {
  const previous = vectorUpdateTail;
  let release!: () => void;
  vectorUpdateTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    options.signal?.throwIfAborted();
    const db = await getDatabase();
    const saved = await db.getAll("semanticVectors");
    const cache = new Map(saved.filter((item) => item.modelKey === embedding.modelKey).map((item) => [item.id, item]));
    if (!rebuild && !options.allowNewModel && saved.length && !cache.size) { options.onVectorUnavailable?.(); return { cache, saved }; }
    const pending = documents.filter((document) => rebuild || cache.get(`${embedding.modelKey}:${document.id}`)?.textHash !== textHash(vectorText(document)))
      .sort((a, b) => Number(Boolean(b.episodeId)) - Number(Boolean(a.episodeId))).slice(0, limit);
    options.onVectorProgress?.(0, pending.length);
    for (let start = 0; start < pending.length;) {
      options.signal?.throwIfAborted();
      const batch: Document[] = [];
      let batchTokens = 0;
      let batchCharacters = 0;
      while (start + batch.length < pending.length && batch.length < 16) {
        const next = pending[start + batch.length];
        const text = vectorText(next);
        const tokens = estimateTokens(text, embedding.modelId);
        if (batch.length && (batchTokens + tokens > 14000 || batchCharacters + text.length > 23000)) break;
        batch.push(next); batchTokens += tokens; batchCharacters += text.length;
      }
      const texts = batch.map(vectorText);
      const vectors = await embedding.embedBatch(texts, options.signal);
      options.signal?.throwIfAborted();
      if (vectors.length !== batch.length) throw new Error("Embedding provider returned an incomplete batch.");
      const previousDimension = !rebuild && [...cache.values()][0]?.values.length;
      if (previousDimension && vectors.some((vector) => vector.length !== previousDimension)) {
        localStorage.setItem("atlas-semantic-index-incompatible", embedding.modelKey);
        throw new Error("Embedding dimensions changed. Rebuild the semantic index.");
      }
      for (const [position, document] of batch.entries()) {
        const item = { id: `${embedding.modelKey}:${document.id}`, modelKey: embedding.modelKey, textHash: textHash(texts[position]), values: vectors[position], embeddingProvider: embedding.providerId, embeddingModel: embedding.modelId, embeddingDimension: vectors[position].length, embeddingVersion: embedding.version, updatedAt: Date.now() };
        await db.put("semanticVectors", item);
        cache.set(item.id, item);
      }
      start += batch.length;
      options.onVectorProgress?.(start, pending.length);
    }
    return { cache, saved };
  } finally { release(); }
}

const queuedConversationIds = new Map<string, string | undefined>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshRunning = false;

function scheduleSemanticVectorRefresh(): void {
  if (refreshTimer || refreshRunning || !queuedConversationIds.size) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshRunning = true;
    const groups = new Map<string | undefined, string[]>();
    for (const [id, runId] of queuedConversationIds) groups.set(runId, [...groups.get(runId) ?? [], id]);
    queuedConversationIds.clear();
    void (async () => { for (const [runId, ids] of groups) await refreshSemanticVectorsForConversations(ids, false, runId); })().catch(() => undefined).finally(() => { refreshRunning = false; scheduleSemanticVectorRefresh(); });
  }, 0);
}

/** New or revised semantic artifacts are embedded after apply, independently of the next source search. */
export function queueSemanticVectorRefresh(conversationIds: string[], runId?: string): void {
  for (const id of conversationIds) queuedConversationIds.set(id, runId);
  scheduleSemanticVectorRefresh();
}

export async function refreshSemanticVectorsForConversations(conversationIds: string[], rebuild = false, runId?: string): Promise<void> {
  if (!conversationIds.length) return;
  const db = await getDatabase();
  const settings = effectiveAISettings(await db.get("aiSettings", "ai-settings"));
  // Hosted Demo calls are reserved for explicit organization.
  if (aiMode(settings) === "demo" && !runId) return;
  const embedding = await resolveEmbeddingProvider(settings, undefined, runId, conversationIds);
  if (!embedding || aiMode(settings) === "byok" && !await hasProviderPermission(settings.baseUrl)) return;
  const scopedIds = [...new Set(conversationIds)];
  const records = await Promise.all(scopedIds.map(async (id) => ({
    conversation: await db.get("conversations", id),
    profile: await db.get("semanticProfiles", id),
    graph: await db.get("conversationGraphs", id),
    messages: await db.getAllFromIndex("messages", "by-conversation", id),
  })));
  const documents = [...semanticDocuments(records.flatMap((item) => item.conversation ? [item.conversation] : []), records.flatMap((item) => item.profile ? [item.profile] : []), records.flatMap((item) => item.graph ? [item.graph] : [])), ...rawSemanticDocuments(records.flatMap(item => item.messages.filter(message => message.content.trim() && !isInternalSearchQueryMessage(message))))];
  await updateSemanticVectors(documents, embedding, Infinity, rebuild);
  if (rebuild && localStorage.getItem("atlas-semantic-index-incompatible") === embedding.modelKey) localStorage.removeItem("atlas-semantic-index-incompatible");
  const currentIds = new Set(documents.map((document) => `${embedding.modelKey}:${document.id}`));
  const saved = await db.getAll("semanticVectors");
  for (const item of saved) {
    if (item.modelKey !== embedding.modelKey || currentIds.has(item.id)) continue;
    if (scopedIds.some((id) => item.id === `${embedding.modelKey}:profile:${id}` || item.id === `${embedding.modelKey}:conversation:${id}` || item.id.startsWith(`${embedding.modelKey}:episode:${id}:`) || item.id.startsWith(`${embedding.modelKey}:passage:${id}:`))) await db.delete("semanticVectors", item.id);
  }
}

export async function semanticIndexRebuildRequired(embedding: EmbeddingProvider): Promise<boolean> {
  if (localStorage.getItem("atlas-semantic-index-incompatible") === embedding.modelKey) return true;
  const saved = await (await getDatabase()).getAll("semanticVectors");
  return saved.length > 0 && !saved.some((item) => item.modelKey === embedding.modelKey);
}

export async function rebuildSemanticIndex(): Promise<void> {
  const db = await getDatabase();
  const conversations = await db.getAll("conversations");
  await refreshSemanticVectorsForConversations(conversations.map((item) => item.id), true);
}

/** Saved projects index only their confirmed raw scope, at most 64 changed windows per refresh. */
export async function refreshProjectVectors(session: FocusSession): Promise<void> {
  const db = await getDatabase();
  const settings = effectiveAISettings(await db.get("aiSettings", "ai-settings"));
  if (aiMode(settings) !== "byok" || !settings.embeddingModel || !await hasProviderPermission(settings.baseUrl)) return;
  const embedding = await resolveEmbeddingProvider(settings, undefined, undefined, session.sourceConversationIds);
  if (!embedding) return;
  const messages = (await Promise.all(session.sourceConversationIds.map(id => db.getAllFromIndex("messages", "by-conversation", id)))).flat().filter(message => message.content.trim() && !isInternalSearchQueryMessage(message) && (session.scope?.kind !== "goal" || session.scope.blocks?.some(block => block.conversationId === message.conversationId && block.messageIds.includes(message.id))));
  await updateSemanticVectors(rawSemanticDocuments(messages), embedding, 64);
}

export async function searchSemanticArtifacts(query: string, documents: Document[], limit = 60, embedding?: EmbeddingProvider | null, vectorBuildLimit = 64, options: SemanticSearchOptions = {}): Promise<SemanticHit[]> {
  options.signal?.throwIfAborted();
  const current = new Set(documents.map((document) => document.id));
  for (const id of fingerprints.keys()) if (!current.has(id)) { await remove(index, id); fingerprints.delete(id); }
  for (const document of documents) {
    const signature = JSON.stringify(document);
    if (fingerprints.get(document.id) === signature) continue;
    if (fingerprints.has(document.id)) await remove(index, document.id);
    await insert(index, document);
    fingerprints.set(document.id, signature);
  }
  if (!query.trim()) return [];
  const result = await search(index, { term: searchTerms(query), properties: ["title", "body", "terms"], boost: { title: 2.5, terms: 1.5 }, limit });
  const ranked = new Map<string, { document: Document; score: number }>();
  for (const [position, hit] of result.hits.entries()) ranked.set(hit.document.id, { document: hit.document, score: 1 / (60 + position + 1) });
  if (embedding) {
    try {
      // Search may cover only a source scope. Never delete cached vectors outside it.
      const { cache } = await updateSemanticVectors(options.vectorDocuments ?? documents, embedding, vectorBuildLimit, false, options);
      const embedded = documents.flatMap((document) => {
        const item = cache.get(`${embedding.modelKey}:${document.id}`);
        return item?.textHash === textHash(vectorText(document)) ? [{ document, values: item.values }] : [];
      });
      const dimension = embedded[0]?.values.length;
      if (dimension) {
        if (!vectorState || vectorState.modelKey !== embedding.modelKey || vectorState.dimension !== dimension) vectorState = createVectorState(dimension, embedding.modelKey);
        const state = vectorState;
        const currentVectorIds = new Set(embedded.filter((item) => item.values.length === dimension).map((item) => item.document.id));
        for (const id of state.fingerprints.keys()) if (!currentVectorIds.has(id)) { await remove(state.index, id); state.fingerprints.delete(id); }
        for (const item of embedded.filter((entry) => entry.values.length === dimension)) {
          const signature = textHash(vectorText(item.document));
          if (state.fingerprints.get(item.document.id) === signature) continue;
          if (state.fingerprints.has(item.document.id)) await remove(state.index, item.document.id);
          await insert(state.index, { ...item.document, embedding: item.values });
          state.fingerprints.set(item.document.id, signature);
        }
        const db = await getDatabase();
        const normalizedQuery = query.trim().normalize("NFKC").toLocaleLowerCase();
        const queryId = `${embedding.modelKey}:query:${textHash(normalizedQuery)}`;
        const queryCache = await db.get("semanticVectors", queryId);
        const vector = queryCache?.textHash === normalizedQuery && queryCache.values.length === dimension ? queryCache.values : await embedding.embedText(query, options.signal);
        if (vector.length === dimension && queryCache?.textHash !== normalizedQuery) {
          await db.put("semanticVectors", { id: queryId, modelKey: embedding.modelKey, textHash: normalizedQuery, values: vector, updatedAt: Date.now() });
          const queries = (await db.getAll("semanticVectors")).filter((item) => item.id.includes(":query:")).sort((a, b) => b.updatedAt - a.updatedAt);
          for (const item of queries.slice(50)) await db.delete("semanticVectors", item.id);
        }
        options.signal?.throwIfAborted();
        if (vector.length === dimension) {
          const hybrid = await search(state.index, { mode: "vector", vector: { value: vector, property: "embedding" }, similarity: 0.45, limit });
          for (const [position, hit] of hybrid.hits.entries()) {
            const previous = ranked.get(hit.document.id);
            ranked.set(hit.document.id, { document: hit.document, score: (previous?.score ?? 0) + 1 / (60 + position + 1) });
          }
        } else options.onVectorUnavailable?.();
      }
    } catch { options.signal?.throwIfAborted(); options.onVectorUnavailable?.(); }
  }
  return [...ranked.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(({ document, score }) => ({ documentId: document.id, conversationId: document.conversationId, ...(document.episodeId ? { episodeId: document.episodeId } : {}), score }));
}
