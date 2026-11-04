import { create, insert, remove, search } from "@orama/orama";
import type { Conversation, ConversationMessage } from "../shared/types";
import { getDatabase } from "../storage/db";
import { isInternalSearchQueryMessage, readableConversationText } from "../shared/conversation-text";
import { searchExcerpt } from "./query";
import { matchesNearbyQuery, matchesMessageQuery, messageQueryRange, messageSearchTokens, planMessageQuery } from "./message-query";
import type { MessageSourceRange } from "../shared/message-location";
import { onMessageSearchInvalidation } from "./message-search-invalidation";
import { getMessageSearchDatabase, type MessageSearchDocument, type MessageSearchManifest, type MessageSearchState } from "./message-search-store";

export const MESSAGE_SEARCH_VERSION = 3;
export { messageSearchTokens } from "./message-query";
const schema = { id: "string", messageId: "string", messageKey: "string", conversationId: "string", platform: "string", title: "string", body: "string", terms: "enum[]", timestamp: "number", chunk: "number", generation: "string", sourceStart: "number", sourceEnd: "number", sourcePart: "string", partIndex: "number" } as const;
function newIndex() { return create({ schema, components: { tokenizer: { language: "atlas-message-v1", normalizationCache: new Map<string, string>(), tokenize: messageSearchTokens } } }); }
const metadata = (c: Conversation) => JSON.stringify([c.title, c.platform, c.rawRevision, c.sourceRevision, c.updatedAt, c.messageCount]);
function digest(text: string) {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); a = Math.imul(a ^ n, 16777619); b = Math.imul(b, 33) ^ n; }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
function fingerprint(message: ConversationMessage, conversation?: Conversation) {
  return digest(JSON.stringify([message.conversationId, message.messageIndex, message.platformMessageId, message.content, message.uiParts?.map(part => part.fallbackText), message.role, message.createdAt, message.updatedAt, conversation?.title, conversation?.platform]));
}
function documents(message: ConversationMessage, conversation: Conversation | undefined, generation: string): MessageSearchDocument[] {
  if (isInternalSearchQueryMessage(message)) return [];
  const result: MessageSearchDocument[] = [];
  const parts = [{ body: message.content, sourcePart: "content" as const, partIndex: -1 }, ...(message.uiParts ?? []).map((part, partIndex) => ({ body: part.fallbackText ?? "", sourcePart: "ui" as const, partIndex }))];
  for (const part of parts) {
    if (!part.body.trim()) continue;
    for (let at = 0; at < part.body.length; at += 3800) {
      const body = part.body.slice(at, at + 4000), chunk = result.length;
      result.push({ id: JSON.stringify([generation, message.id, chunk]), generation, messageId: message.id, messageKey: JSON.stringify(message.id), conversationId: message.conversationId, platform: conversation?.platform ?? "", title: conversation?.title ?? "", body, terms: messageSearchTokens(`${body} ${conversation?.title ?? ""}`), timestamp: message.createdAt, chunk, sourceStart: at, sourceEnd: Math.min(at + 4000, part.body.length), sourcePart: part.sourcePart, partIndex: part.partIndex });
    }
  }
  return result;
}
export interface MessageSearchOptions { minimumTermCoverage?: number; requireBodyMatch?: boolean; proximity?: number; platforms?: string[]; conversationIds?: string[]; from?: number; to?: number; limit?: number; offset?: number; signal?: AbortSignal }
export interface MessageSearchHit { messageId: string; conversationId: string; summary: string; score: number; platform: string; timestamp: number; sourceRange: MessageSourceRange; message: ConversationMessage }
export interface MessageSearchResponse { hits: MessageSearchHit[]; total: number; version: number; indexedMessages: number; totalExact?: boolean }
/** Future hybrid providers can consume these source IDs without changing the raw stores. */
export interface MessageRetriever { search(query: string, options?: MessageSearchOptions): Promise<MessageSearchResponse> }
export interface IndexProgress { phase: "building" | "reconciling" | "ready"; processed: number; generation: string }
let localQueue: Promise<unknown> = Promise.resolve();
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const job = () => typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request("atlas-message-fulltext-write", work) : work();
  const result = localQueue.then(job, job); localQueue = result.catch(() => undefined); return result;
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0));
interface IndexedMessage { bodyTerms?: Set<string>; documents: MessageSearchDocument[]; terms: Set<string>; fingerprint: string }
/** Reassemble only quoted queries, avoiding a second full-corpus string cache. */
function messageFields(docs: MessageSearchDocument[]): string[] {
  const fields = new Map<string, string>();
  for (const doc of docs) { const key = `${doc.sourcePart}:${doc.partIndex}`, previous = fields.get(key) ?? ""; fields.set(key, previous + doc.body.slice(Math.max(0, previous.length - doc.sourceStart))); }
  return [docs[0]?.title ?? "", ...fields.values()];
}
export class MessageFullTextSearch implements MessageRetriever {
  private index = newIndex();
  private loaded = "";
  private epoch = -1;
  private initialized = false;
  private dirty = new Set<string>();
  private allDirty = false;
  private indexedMessages = 0;
  private lastFullCheck = 0;
  private records = new Map<string, IndexedMessage>();
  private maintenance?: Promise<void>;
  private maintenanceTimer?: ReturnType<typeof setTimeout>;
  private invalidation = 0;
  constructor(private readonly version = MESSAGE_SEARCH_VERSION) {}
  invalidate(conversationId?: string) { this.invalidation++; if (conversationId) this.dirty.add(conversationId); else this.allDirty = true; }
  /** Full safety checks are explicit/background work, never a warm-query timer. */
  scheduleMaintenance() {
    if (this.maintenance || this.maintenanceTimer) return;
    this.maintenanceTimer = setTimeout(() => {
      this.maintenanceTimer = undefined;
      this.maintenance = this.prepare().catch(() => { this.invalidate(); }).finally(() => { this.maintenance = undefined; });
    }, 0);
  }
  async settleMaintenance() {
    if (this.maintenanceTimer) { clearTimeout(this.maintenanceTimer); this.maintenanceTimer = undefined; }
    await this.maintenance;
    await this.prepare();
  }
  private remember(messageId: string, docs: MessageSearchDocument[], value: string) {
    this.records.set(messageId, { documents: docs, terms: new Set(docs.flatMap(doc => doc.terms)), fingerprint: value });
  }
  private async state() {
    const value = await (await getMessageSearchDatabase()).get("messageSearchState", "state");
    return value && Number.isFinite(value.epoch) && Number.isFinite(value.version) && value.conversations && typeof value.conversations === "object" ? value : { id: "state" as const, version: this.version, epoch: 0, conversations: {}, updatedAt: 0 };
  }
  private async load(state: MessageSearchState) {
    if (!state.active || this.loaded === state.active && this.epoch === state.epoch) return;
    const db = await getMessageSearchDatabase(), index = newIndex();
    const tx = db.transaction(["messageSearchDocuments", "messageSearchManifests"]); let cursor = await tx.objectStore("messageSearchDocuments").index("generation").openCursor(state.active);
    const ids = new Set<string>(), byId = new Map<string, MessageSearchDocument>();
    while (cursor) { insert(index, cursor.value); ids.add(cursor.value.id); byId.set(cursor.value.id,cursor.value); cursor = await cursor.continue(); }
    const manifests = await tx.objectStore("messageSearchManifests").index("generation").getAll(state.active);
    if (manifests.some(m => !Array.isArray(m.documentIds) || m.documentIds.some(id => !ids.has(id)) || m.documentFingerprint !== digest(JSON.stringify(m.documentIds.map(id => byId.get(id))))) || manifests.reduce((total, m) => total + m.documentIds.length, 0) !== ids.size) throw new Error("Corrupt message search generation");
    await tx.done; this.records = new Map();
    for (const manifest of manifests) this.remember(manifest.messageId, manifest.documentIds.map(id => byId.get(id)!), manifest.fingerprint);
    this.index = index; this.loaded = state.active; this.epoch = state.epoch; this.indexedMessages = manifests.filter(m => m.documentIds.length).length;
  }
  private async upsert(message: ConversationMessage, conversation: Conversation | undefined, generation: string) {
    const db = await getMessageSearchDatabase(), id = JSON.stringify([generation, message.id]), old = await db.get("messageSearchManifests", id), nextFingerprint = fingerprint(message, conversation);
    if (old?.fingerprint === nextFingerprint) return;
    const next = documents(message, conversation, generation), tx = db.transaction(["messageSearchDocuments", "messageSearchManifests"], "readwrite");
    for (const documentId of old?.documentIds ?? []) await tx.objectStore("messageSearchDocuments").delete(documentId);
    for (const document of next) await tx.objectStore("messageSearchDocuments").put(document);
    await tx.objectStore("messageSearchManifests").put({ id, generation, conversationId: message.conversationId, messageId: message.id, fingerprint: nextFingerprint, documentFingerprint: digest(JSON.stringify(next)), documentIds: next.map(doc => doc.id) });
    await tx.done;
    if (this.loaded === generation) { this.remember(message.id, next, nextFingerprint); this.indexedMessages += Number(Boolean(next.length)) - Number(Boolean(old?.documentIds.length)); for (const documentId of old?.documentIds ?? []) remove(this.index, documentId); for (const document of next) insert(this.index, document); }
  }
  private async removeManifest(manifest: MessageSearchManifest) {
    const db = await getMessageSearchDatabase(), tx = db.transaction(["messageSearchDocuments", "messageSearchManifests"], "readwrite");
    for (const id of manifest.documentIds) await tx.objectStore("messageSearchDocuments").delete(id);
    await tx.objectStore("messageSearchManifests").delete(manifest.id); await tx.done;
    if (this.loaded === manifest.generation) { this.records.delete(manifest.messageId); this.indexedMessages -= Number(Boolean(manifest.documentIds.length)); for (const id of manifest.documentIds) remove(this.index, id); }
  }
  private async batch(after?: string) {
    const db = await getDatabase(), tx = db.transaction("messages"), rows: ConversationMessage[] = [];
    let cursor = await tx.store.openCursor(after ? IDBKeyRange.lowerBound(after, true) : undefined);
    while (cursor && rows.length < 100) { rows.push(cursor.value); cursor = await cursor.continue(); }
    await tx.done; return rows;
  }
  private async reconcile(state: MessageSearchState, conversations: Conversation[], ids?: Set<string>, signal?: AbortSignal, progress?: (value: IndexProgress) => void, persist = true) {
    const raw = await getDatabase(), derived = await getMessageSearchDatabase(), generation = state.active!, byId = new Map(conversations.map(c => [c.id, c])), seen = new Set<string>();
    if (ids) {
      for (const id of ids) { signal?.throwIfAborted(); const rows = await raw.getAllFromIndex("messages", "by-conversation", id); for (const message of rows) { seen.add(message.id); await this.upsert(message, byId.get(id), generation); } }
    } else {
      let after: string | undefined, processed = 0;
      for (;;) { signal?.throwIfAborted(); const rows = await this.batch(after); if (!rows.length) break; for (const message of rows) { seen.add(message.id); await this.upsert(message, byId.get(message.conversationId), generation); } after = rows.at(-1)!.id; processed += rows.length; progress?.({ phase: "reconciling", processed, generation }); await pause(); }
    }
    const manifests = ids ? (await Promise.all([...ids].map(id => derived.getAllFromIndex("messageSearchManifests", "conversation", [generation, id])))).flat() : await derived.getAllFromIndex("messageSearchManifests", "generation", generation);
    for (const manifest of manifests) if (!seen.has(manifest.messageId)) await this.removeManifest(manifest);
    state.conversations = Object.fromEntries(conversations.map(c => [c.id, metadata(c)])); state.epoch++; state.updatedAt = Date.now();
    signal?.throwIfAborted();
    if (persist) await derived.put("messageSearchState", state);
    this.epoch = state.epoch;
    if (!ids) this.lastFullCheck = Date.now();
  }
  private async build(state: MessageSearchState, signal?: AbortSignal, progress?: (value: IndexProgress) => void, repair = true): Promise<void> {
    const derived = await getMessageSearchDatabase(), raw = await getDatabase();
    if (!state.building || state.building.version !== this.version) state.building = { generation: crypto.randomUUID(), version: this.version, processed: 0 };
    await derived.put("messageSearchState", state);
    const build = state.building, conversations = await raw.getAll("conversations"), byId = new Map(conversations.map(c => [c.id,c]));
    for (;;) {
      signal?.throwIfAborted(); const rows = await this.batch(build.cursor); if (!rows.length) break;
      for (const message of rows) { signal?.throwIfAborted(); await this.upsert(message, byId.get(message.conversationId), build.generation); }
      build.cursor = rows.at(-1)!.id; build.processed += rows.length; await derived.put("messageSearchState", state);
      progress?.({ phase: "building", processed: build.processed, generation: build.generation }); await pause();
    }
    // Reconcile resumed batches too: imports may have changed keys before the checkpoint.
    const next: MessageSearchState = { ...state, active: build.generation, version: this.version, building: undefined, epoch: state.epoch + 1 };
    const staged = new MessageFullTextSearch(this.version);
    try { await staged.load(next); }
    catch (failure) {
      // A resumed staging generation can be corrupt too. Discard only that
      // derived generation and retry from originals once, retaining the active one.
      if (!repair) throw failure;
      signal?.throwIfAborted(); state.building = undefined;
      return this.build(state, signal, progress, false);
    }
    await staged.reconcile(next, await raw.getAll("conversations"), undefined, signal, progress, false);
    signal?.throwIfAborted(); await derived.put("messageSearchState", next); this.initialized = true;
    this.index = staged.index; this.records = staged.records; this.loaded = staged.loaded; this.epoch = staged.epoch; this.indexedMessages = staged.indexedMessages; this.lastFullCheck = staged.lastFullCheck;
    // Only committed promotion permits cleanup of obsolete derived generations.
    const tx = derived.transaction(["messageSearchDocuments", "messageSearchManifests"], "readwrite");
    for (const name of ["messageSearchDocuments", "messageSearchManifests"] as const) { let cursor = await tx.objectStore(name).openCursor(); while (cursor) { if (cursor.value.generation !== next.active) await cursor.delete(); cursor = await cursor.continue(); } }
    await tx.done; progress?.({ phase: "ready", processed: build.processed, generation: next.active! });
  }
  async prepare(options: { signal?: AbortSignal; onProgress?: (value: IndexProgress) => void } = {}) {
    await exclusive(async () => {
      const revision = this.invalidation;
      const state = await this.state();
      if (!state.active || state.version !== this.version || state.building?.version === this.version) { await this.build(state, options.signal, options.onProgress); if (revision === this.invalidation) { this.dirty.clear(); this.allDirty = false; } return; }
      try { await this.load(state); } catch { state.building = undefined; await this.build(state, options.signal, options.onProgress); return; }
      const conversations = await (await getDatabase()).getAll("conversations"), changed = new Set(this.dirty);
      for (const c of conversations) if (state.conversations[c.id] !== metadata(c)) changed.add(c.id);
      const currentIds = new Set(conversations.map(c => c.id));
      for (const id of Object.keys(state.conversations)) if (!currentIds.has(id)) changed.add(id);
      if (!this.initialized || this.allDirty || Date.now() - this.lastFullCheck > 30000) await this.reconcile(state, conversations, undefined, options.signal, options.onProgress);
      else if (changed.size) await this.reconcile(state, conversations, changed, options.signal, options.onProgress);
      this.initialized = true; if (revision === this.invalidation) { this.dirty.clear(); this.allDirty = false; }
    });
  }
  private async readyForSearch(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const state = await this.state();
    if (!state.active || state.version !== this.version) { await this.prepare({ signal }); return; }
    try { await this.load(state); } catch { await this.prepare({ signal }); return; }
    // A fresh process checks original records once; warm reads only reconcile
    // changed conversation revisions. A healthy generation stays readable while rebuilding.
    const conversations = await (await getDatabase()).getAll("conversations");
    const changed = this.dirty.size || conversations.length !== Object.keys(state.conversations).length || conversations.some(c => state.conversations[c.id] !== metadata(c));
    if ((!this.initialized || changed || this.allDirty) && !state.building) {
      // Explicitly stale source revisions must settle before the next query;
      // an already scheduled maintenance pass is not a freshness guarantee.
      if (this.maintenance) await this.maintenance;
      signal?.throwIfAborted();
      await this.prepare({ signal });
    }
    if (state.building || this.allDirty || Date.now() - this.lastFullCheck > 30000) this.scheduleMaintenance();
  }
  async refresh(conversationId?: string, signal?: AbortSignal) { this.invalidate(conversationId); await this.prepare({ signal }); }
  /** Adapter API: read committed originals by ID, including tombstones for deleted IDs. */
  async updateMessages(messageIds: string[], signal?: AbortSignal) {
    await this.prepare({ signal });
    await exclusive(async () => {
      const state = await this.state(); await this.load(state); const raw = await getDatabase(), derived = await getMessageSearchDatabase();
      for (const id of new Set(messageIds)) { signal?.throwIfAborted(); const message = await raw.get("messages", id); if (message) await this.upsert(message, await raw.get("conversations", message.conversationId), state.active!); else { const manifest = await derived.get("messageSearchManifests", JSON.stringify([state.active, id])); if (manifest) await this.removeManifest(manifest); } }
      state.epoch++; state.updatedAt = Date.now(); await derived.put("messageSearchState", state); this.epoch = state.epoch;
    });
  }
  async rebuild(options: { signal?: AbortSignal; onProgress?: (value: IndexProgress) => void } = {}) {
    await exclusive(async () => { const state = await this.state(); state.building = undefined; await this.build(state, options.signal, options.onProgress); });
  }
  async status() { const state = await this.state(), db = await getMessageSearchDatabase(); return { ...state, indexedMessages: state.active ? (await db.getAllFromIndex("messageSearchManifests", "generation", state.active)).filter(m => m.documentIds.length).length : 0 }; }
  async search(query: string, options: MessageSearchOptions = {}): Promise<MessageSearchResponse> {
    return this.retrieve(query, options);
  }
  /** Quick reuse never starts a library-wide build, load or reconciliation. */
  async searchReady(query:string,options:MessageSearchOptions):Promise<MessageSearchResponse|undefined> {
    options.signal?.throwIfAborted();
    const state=await this.state();
    if(!this.initialized||!state.active||state.active!==this.loaded||state.epoch!==this.epoch||state.version!==this.version||this.allDirty||state.building)return;
    const db=await getDatabase();
    for(const id of options.conversationIds??[]){const source=await db.get("conversations",id);if(!source||this.dirty.has(id)||state.conversations[id]!==metadata(source))return;}
    return this.retrieve(query,options,false,true);
  }
  /** Library list filtering: one strongest message per conversation, without a message-page cutoff. */
  async searchConversations(query: string, options: MessageSearchOptions = {}): Promise<MessageSearchResponse> {
    return this.retrieve(query, options, true);
  }
  private async retrieve(query: string, options: MessageSearchOptions, conversationsOnly = false, ready = false): Promise<MessageSearchResponse> {
    const plan = planMessageQuery(query);
    if (!plan.search || options.platforms?.length === 0 || options.conversationIds?.length === 0) return { hits: [], total: 0, version: this.version, indexedMessages: 0, totalExact: true };
    if(!ready)await this.readyForSearch(options.signal); options.signal?.throwIfAborted();
    const index = this.index, records = this.records;
    const where = { ...(options.platforms ? { platform: options.platforms } : {}), ...(options.conversationIds ? { conversationId: options.conversationIds } : {}), ...(options.from !== undefined || options.to !== undefined ? { timestamp: { between: [options.from ?? 0, options.to ?? Number.MAX_SAFE_INTEGER] as [number,number] } } : {}) };
    // Ask Orama for one strongest chunk per message. Coverage is checked on the
    // entire message, so distant terms can cooperate without combining conversations.
    const results = await search(index, { term: plan.search, properties: ["body", "title"], threshold: 1, tolerance: 0, where, limit: 1, groupBy: { properties: ["messageKey"], maxResult: 1 } });
    const candidates = (results.groups ?? []).flatMap(group => {
      const hit = group.result[0], record = hit && records.get(hit.document.messageId);
      if (!hit || !record || !matchesMessageQuery(plan, record.terms, plan.phrases.length ? messageFields(record.documents) : [], options.minimumTermCoverage)) return [];
      if (options.proximity || options.requireBodyMatch) {
        const fields = messageFields(record.documents).slice(options.requireBodyMatch ? 1 : 0);
        if (options.requireBodyMatch && !matchesMessageQuery(plan, record.bodyTerms ??= new Set(fields.flatMap(messageSearchTokens)), fields, options.minimumTermCoverage)) return [];
        if (options.proximity && !matchesNearbyQuery(plan, fields, options.proximity, options.minimumTermCoverage)) return [];
      }
      const doc = (options.requireBodyMatch ? record.documents.find(item => matchesMessageQuery(plan, new Set(messageSearchTokens(item.body)), item.body, options.minimumTermCoverage) && (!options.proximity || matchesNearbyQuery(plan, [item.body], options.proximity, options.minimumTermCoverage))) : undefined)
        ?? record.documents.find(item => item.id === hit.id)!;
      if (!doc) return [];
      const literal = [doc.title, doc.body].some(text => text.normalize("NFKC").toLocaleLowerCase().includes(plan.search));
      return [{ record, doc, score: hit.score + (literal ? 10 : 0) }];
    }).sort((a,b) => b.score - a.score || b.doc.timestamp - a.doc.timestamp || a.doc.messageId.localeCompare(b.doc.messageId));
    const raw = await getDatabase(), hits: MessageSearchHit[] = [], seen = new Set<string>();
    const offset = Math.max(0, options.offset ?? 0), limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const selected = conversationsOnly ? candidates : candidates.slice(offset);
    const conversations = new Map<string, Conversation | undefined>();
    let stale = 0;
    // Hydrate only the requested message page. Totals describe the current
    // indexed snapshot; unvisited sources have not been revalidated (totalExact=false).
    for (let start = 0; start < selected.length && (conversationsOnly || hits.length < limit);) {
      options.signal?.throwIfAborted();
      const batch = selected.slice(start, start + (conversationsOnly ? 32 : Math.min(32, limit - hits.length)));
      start += batch.length;
      const messages = await Promise.all(batch.map(item => raw.get("messages", item.doc.messageId)));
      await Promise.all([...new Set(messages.flatMap(message => message && !conversations.has(message.conversationId) ? [message.conversationId] : []))].map(async id => conversations.set(id, await raw.get("conversations", id))));
      for (const [at, item] of batch.entries()) {
        const message = messages[at], conversation = message && conversations.get(message.conversationId);
        if (!message || item.record.fingerprint !== fingerprint(message, conversation)) { stale++; this.invalidate(item.doc.conversationId); continue; }
        const key = conversationsOnly ? message.conversationId : message.id;
        if (seen.has(key)) continue;
        const parts = [{ text: message.content, part: "content" as const, partIndex: -1 }, ...(message.uiParts ?? []).map((part, partIndex) => ({ text: part.fallbackText ?? "", part: "ui" as const, partIndex }))];
        const source = parts.find(part => part.part === item.doc.sourcePart && part.partIndex === item.doc.partIndex)!;
        const local = messageQueryRange(plan, source.text.slice(item.doc.sourceStart, item.doc.sourceEnd));
        const entire = !local && plan.phrases.length ? messageQueryRange(plan, source.text) : undefined;
        const sourceRange: MessageSourceRange = { start: entire?.start ?? item.doc.sourceStart + (local?.start ?? 0), end: entire?.end ?? (local ? item.doc.sourceStart + local.end : item.doc.sourceEnd), part: source.part, partIndex: source.partIndex };
        sourceRange.excerpt = local || entire ? source.text.slice(sourceRange.start, sourceRange.end) : undefined;
        const excerptAt = Math.max(0, sourceRange.start - 50), excerptEnd = Math.min(source.text.length, excerptAt + 210);
        const summary = local || entire ? `${excerptAt ? "…" : ""}${readableConversationText(source.text.slice(excerptAt, excerptEnd))}${excerptEnd < source.text.length ? "…" : ""}` : searchExcerpt(plan.search, readableConversationText(item.doc.body));
        seen.add(key); hits.push({ messageId: message.id, conversationId: message.conversationId, summary, score: item.score, platform: conversation?.platform ?? item.doc.platform, timestamp: message.createdAt, sourceRange, message });
      }
    }
    if (stale) this.scheduleMaintenance();
    return { hits, total: conversationsOnly ? hits.length : Math.max(0, candidates.length - stale), totalExact: conversationsOnly || offset === 0 && hits.length >= candidates.length - stale, version: this.version, indexedMessages: this.indexedMessages };
  }
}
export const messageFullTextSearch = new MessageFullTextSearch();
onMessageSearchInvalidation(() => messageFullTextSearch.invalidate());
