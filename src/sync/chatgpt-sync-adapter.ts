import type { Conversation, ConversationCapture, ImportFailureCategory } from "../shared/types";
import { normalizeHistoryConversation, normalizeHistoryItem, type RawConversation, type RawConversationPage } from "./chatgpt-normalizer";
export { normalizeHistoryConversation, normalizeHistoryItem } from "./chatgpt-normalizer";

export class ChatGPTSyncError extends Error {
  constructor(message: string, readonly retryable = false, readonly category: ImportFailureCategory = "unknown", readonly status?: number, readonly retryAfterMs?: number) { super(message); }
}

/** Isolates ChatGPT's undocumented web-session endpoints from the rest of ChatAtlas. */
export class ChatGPTSyncAdapter {
  private token: string | null = null;
  private sessionChecked = false;

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch("https://chatgpt.com/api/auth/session", { credentials: "include", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return false;
      const session = await response.json() as { accessToken?: string; user?: unknown };
      this.sessionChecked = true;
      this.token = session.accessToken ?? null;
      return Boolean(session.accessToken || session.user);
    } catch { return false; }
  }

  private async accessToken(): Promise<string | null> {
    if (this.sessionChecked) return this.token;
    const response = await fetch("https://chatgpt.com/api/auth/session", { credentials: "include", signal: AbortSignal.timeout(15_000) });
    this.sessionChecked = true;
    if (!response.ok) return null;
    const session = await response.json() as { accessToken?: string };
    this.token = session.accessToken ?? null;
    return this.token;
  }

  private async get<T>(path: string): Promise<T> {
    const request = async () => {
      const token = await this.accessToken();
      try { return await fetch(`https://chatgpt.com${path}`, { credentials: "include", headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: AbortSignal.timeout(30_000) }); }
      catch { throw new ChatGPTSyncError("ChatGPT history request lost its network connection.", true, "network"); }
    };
    let response = await request();
    if (response.status === 401 && this.token) { this.token = null; this.sessionChecked = false; response = await request(); }
    if (response.status === 401) throw new ChatGPTSyncError("ChatGPT web-session access is unavailable. Sign in or use Export ZIP.", false, "auth", response.status);
    if (response.status === 403) throw new ChatGPTSyncError("This ChatGPT conversation is not accessible.", false, "permission", response.status);
    if (response.status === 404) throw new ChatGPTSyncError("This ChatGPT conversation no longer exists.", false, "not_found", response.status);
    if (!response.ok) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : undefined;
      throw new ChatGPTSyncError(response.status === 429 ? "ChatGPT rate-limited the import. ChatAtlas will retry." : `ChatGPT history request failed (${response.status}).`, response.status === 429 || response.status >= 500, response.status === 429 ? "rate_limit" : response.status >= 500 ? "network" : "unknown", response.status, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined);
    }
    try { return await response.json() as T; } catch { throw new ChatGPTSyncError("ChatGPT returned an unexpected history response.", false, "parse_error"); }
  }

  async discoverConversations(cursor = "0", limit = 50, archived = false): Promise<{ page: RawConversationPage; nextCursor?: string }> {
    const offset = Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ChatGPTSyncError("Invalid history cursor.");
    const page = await this.get<RawConversationPage>(`/backend-api/conversations?offset=${offset}&limit=${limit}${archived ? "&is_archived=true" : ""}`);
    if (!Array.isArray(page.items)) throw new ChatGPTSyncError("ChatGPT history format changed. Use Export ZIP instead.", false, "parse_error");
    if (page.items.length && page.items.some((item) => !item.id)) throw new ChatGPTSyncError("ChatGPT returned conversations without IDs; its history format may have changed.", false, "parse_error");
    const hasMore = page.items.length === limit && (typeof page.total !== "number" || offset + page.items.length < page.total);
    if (import.meta.env.DEV) console.info("[ChatAtlas import] Inventory", { archived, requestStatus: 200, rawCount: page.items.length, cursor, nextCursor: hasMore ? String(offset + page.items.length) : null });
    return { page, nextCursor: hasMore ? String(offset + page.items.length) : undefined };
  }

  async fetchConversation(id: string): Promise<RawConversation> {
    const raw = await this.get<RawConversation>(`/backend-api/conversation/${encodeURIComponent(id)}`);
    if (!raw.mapping) throw new ChatGPTSyncError("ChatGPT conversation format changed. Use Export ZIP instead.", false, "parse_error");
    return { ...raw, id: raw.id || id };
  }

  normalizeConversation(raw: RawConversation): Conversation | null { return normalizeHistoryItem(raw); }
  normalizeMessages(raw: RawConversation): Promise<ConversationCapture> { return normalizeHistoryConversation(raw); }

  async list(offset: number, limit = 50, archived = false): Promise<{ conversations: Conversation[]; hasMore: boolean }> {
    const { page, nextCursor } = await this.discoverConversations(String(offset), limit, archived);
    const conversations = (page.items ?? []).map(normalizeHistoryItem).filter((item): item is Conversation => Boolean(item));
    if (import.meta.env.DEV) console.info("[ChatAtlas import] Normalized inventory", { count: conversations.length, archived, cursor: offset });
    return { conversations, hasMore: Boolean(nextCursor) };
  }

  async getConversation(id: string): Promise<ConversationCapture> {
    const capture = await this.normalizeMessages(await this.fetchConversation(id));
    if (!capture.messages.length) throw new ChatGPTSyncError("ChatGPT returned no readable messages for this conversation.");
    return capture;
  }
}
