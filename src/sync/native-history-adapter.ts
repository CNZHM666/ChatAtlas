import type { Conversation, ConversationCapture } from "../shared/types";
import type { NativeHistoryPage, NativeImportSource, NativeRequest, NativeTransport } from "../shared/native-import";
import { baseConversation, captureFromDrafts, importRevision, sourceTimestamp, type DraftMessage } from "./importers/types";
import { claudeImporter, type ClaudeConversation } from "./importers/claude";
import { normalizeHistoryConversation, normalizeHistoryItem, type RawConversation, type RawHistoryItem } from "./chatgpt-normalizer";
import { doubaoHistoryBody, doubaoRows, doubaoHasMore, doubaoInteger, doubaoNext } from "./doubao-history";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const string = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const fail = (): never => { throw Error("历史接口格式变化，未将部分内容标为完整 / History response format changed"); };
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : fail();
const rows = (value: unknown): Row[] => array(value).map(value => Object.keys(object(value)).length ? object(value) : fail());
const at = (value: unknown, ...positions: number[]): unknown => positions.reduce<unknown>((v, i) => Array.isArray(v) ? v[i] : undefined, value);
const text = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n\n");
  const v = object(value);
  if (v.type === "thinking" || v.type === "reasoning" || v.type === "tool_call") return "";
  return text(v.content ?? v.text ?? v.parts ?? v.text_block ?? v.message) || (v.file_name || v.name ? `【附件 ${string(v.file_name ?? v.name)}】` : "");
};
const more = (flag: unknown, cursor: unknown): string | undefined => {
  if (flag === false || flag === 0) return undefined;
  const next = string(cursor);
  if (flag === true || flag === 1) return next || fail();
  return next || undefined;
};

/** Stateless provider protocols. Durable cursors live in the job, not this object.
 * No adapter treats a malformed page, repeated cursor, or page budget as EOF. */
export class NativeHistoryAdapter {
  constructor(readonly source: NativeImportSource, private transport: NativeTransport, private check = () => {}) {}
  private async request(path: string, body?: unknown, rpc?: NativeRequest["rpc"]) {
    this.check();
    const reply = await this.transport(this.source, { path, ...(body === undefined ? {} : { body }), ...(rpc ? { rpc } : {}) });
    this.check();
    if (!reply.account || this.source.account && reply.account !== this.source.account) throw Error("账号已变化 / Account changed");
    this.source.account = reply.account;
    const data = object(reply.data);
    if (data.is_streaming === true || data.status === "streaming" || object(data.data).is_streaming === true) throw Error("AI 仍在回复，结束后重试 / AI is still replying; retry when finished");
    if (this.source.platform !== "doubao" && (data.success === false || typeof data.code === "number" && data.code !== 0 || typeof object(data.data).biz_code === "number" && object(data.data).biz_code !== 0)) throw Error("账号历史读取被拒绝，请检查登录状态 / History access denied");
    return reply.data;
  }
  private metadata(row: Row, id = string(row.id ?? row.uuid ?? row.session_id ?? row.sessionId ?? row.conversation_id)): Conversation {
    if (!id || !/^[\w-]+$/u.test(id)) return fail();
    const platform = this.source.platform, prefix = platform === "chatgpt" ? "" : platform === "qwen" && this.source.origin !== "https://chat.qwen.ai" ? "qwen:cn:" : `${platform}:`;
    const url = `${this.source.origin}${platform === "deepseek" ? "/a/chat/s/" : platform === "gemini" ? "/app/" : platform === "qwen" && this.source.origin === "https://chat.qwen.ai" ? "/c/" : platform === "chatgpt" ? "/c/" : "/chat/"}${id}`;
    return { ...baseConversation({ id: prefix + id, platform, title: string(row.title ?? row.name ?? row.summary), url, source: `${platform}_history`, createdAt: sourceTimestamp(row.created_at ?? row.create_time ?? row.createTime ?? row.inserted_at), updatedAt: sourceTimestamp(row.updated_at ?? row.update_time ?? row.updateTime ?? row.modifiedTime ?? row.last_req_timestamp) }), sourceAccount: this.source.account, nativeHistorySourceId: this.source.id };
  }
  async list(cursor = ""): Promise<NativeHistoryPage> {
    const { platform } = this.source;
    if (platform === "chatgpt") {
      const state = cursor ? JSON.parse(cursor) as { offset: number; archived: boolean } : { offset: 0, archived: false };
      const data = object(await this.request(`/backend-api/conversations?offset=${state.offset}&limit=50&is_archived=${state.archived}`));
      const items = rows(data.items);
      const conversations = items.map(row => { const item = normalizeHistoryItem(row as RawHistoryItem); if (!item) return fail(); return { ...item, sourceAccount: this.source.account, nativeHistorySourceId: this.source.id }; });
      const hasMore = items.length > 0 && (typeof data.total === "number" ? state.offset + items.length < data.total : items.length === 50);
      return { conversations, next: hasMore ? JSON.stringify({ ...state, offset: state.offset + items.length }) : !state.archived ? JSON.stringify({ offset: 0, archived: true }) : undefined };
    }
    if (platform === "claude") {
      const state = cursor ? JSON.parse(cursor) as { orgs: string[]; org: number; offset: number } : { orgs: rows(await this.request("/api/organizations")).map(row => string(row.uuid) || fail()), org: 0, offset: 0 };
      if (!state.orgs.length) throw Error("没有可访问的 Claude 工作区 / No accessible Claude workspace");
      const data = await this.request(`/api/organizations/${state.orgs[state.org]}/chat_conversations?limit=50&offset=${state.offset}&include_archived=true`);
      const items = rows(Array.isArray(data) ? data : object(data).items);
      const conversations = items.map(row => ({ ...this.metadata(row), nativeHistorySourceId: this.source.id, url: `${this.source.origin}/chat/${string(row.uuid)}`, source: `claude_history:${state.orgs[state.org]}` }));
      return { conversations, next: items.length === 50 ? JSON.stringify({ ...state, offset: state.offset + items.length }) : state.org + 1 < state.orgs.length ? JSON.stringify({ ...state, org: state.org + 1, offset: 0 }) : undefined };
    }
    if (platform === "gemini") {
      const data = await this.request("/app", [50, cursor || null, [0, null, 1]], "MaZiqc");
      // An account or last page with no conversations answers null there, not an empty list.
      const items = Array.isArray(data) && at(data, 2) === null ? [] : array(at(data, 2));
      return { conversations: items.map(row => this.metadata({ title: at(row, 1), updated_at: at(row, 5, 0) }, string(at(row, 0)).replace(/^c_/u, ""))), next: more(undefined, at(data, 1)) };
    }
    if (platform === "deepseek") {
      const data = object(object(object(await this.request(`/api/v0/chat_session/fetch_page?count=50${cursor ? `&lte_cursor.pinned=false&lte_cursor.updated_at=${encodeURIComponent(cursor)}` : ""}`)).data).biz_data);
      const items = rows(data.chat_sessions);
      if (typeof data.has_more !== "boolean") return fail();
      return { conversations: items.map(row => this.metadata(row)), next: more(data.has_more, items.at(-1)?.updated_at) };
    }
    if (platform === "kimi") {
      const data = object(await this.request("/apiv2/kimi.gateway.feed.v1.FeedService/ListFeeds", { pageToken: cursor, pageSize: 50, filterTypes: [1], includePinned: true }));
      // Kimi answers in protobuf JSON, which leaves an empty list out: no items is an empty page, not a changed format.
      return { conversations: rows(data.items ?? []).map(item => this.metadata(object(item.chat ?? object(item.item).value))), next: more(undefined, data.nextPageToken ?? data.next_page_token) };
    }
    if (platform === "qwen") {
      if (this.source.origin === "https://chat.qwen.ai") {
        const page = Number(cursor || 1);
        const data = object(await this.request(`/api/v2/chats/?page=${page}&exclude_project=false`));
        const items = rows(data.data);
        return { conversations: items.map(row => this.metadata(row)), next: items.length ? String(page + 1) : undefined };
      }
      const data = object(object(await this.request("/api/v2/session/page/list", { limit: 50, next_token: cursor, sort_field: "modifiedTime", need_filter_tag: false })).data);
      if (typeof data.have_next_page !== "boolean") return fail();
      return { conversations: rows(data.list).map(row => this.metadata(row)), next: more(data.have_next_page, data.next_token) };
    }
    const page = doubaoHistoryBody(await this.request("/im/chain/recent_conv", this.imBody(3200, "pull_recent_conv_chain_uplink_body", { limit: 50, message_count_per_conv: 10, api_version: 1, conv_version: cursor ? doubaoInteger(cursor, "conv_version") : 0, direction: cursor ? 1 : 3, option: { not_need_message: true, need_complete_conversation: true, need_coco_conversation: !cursor, need_coco_bot: !cursor, need_pc_pin_chain: true, pc_pin_query_type: 0 } })), "pull_recent_conv_chain_downlink_body");
    const conversations = doubaoRows(page.cells, "cells").map(cell => {
      const conversation = object(cell.conversation);
      const id = doubaoInteger(conversation.conversation_id ?? cell.id, "conversation_id");
      return this.metadata(conversation, id);
    });
    return { conversations, next: doubaoNext(page, "next_conv_version") };
  }
  private imBody(cmd: number, field: string, data: Row) { return { cmd, uplink_body: { [field]: data }, sequence_id: crypto.randomUUID(), channel: 2, version: "1" }; }
  async detail(conversation: Conversation): Promise<ConversationCapture> {
    const { platform } = this.source, id = conversation.id.split(":").at(-1)!;
    if (!this.source.account) await this.list();
    if (conversation.sourceAccount && conversation.sourceAccount !== this.source.account) throw Error("账号与已保存来源不一致 / Saved source belongs to another account");
    if (platform === "chatgpt") {
      // The detail may carry no id of its own: the conversation asked for is the one read, as the older ChatGPT sync does.
      const raw = object(await this.request(`/backend-api/conversation/${encodeURIComponent(id)}`)) as RawConversation;
      return this.receipt(await normalizeHistoryConversation({ ...raw, id: raw.id || raw.conversation_id || id }), conversation);
    }
    if (platform === "claude") {
      const org = conversation.source?.startsWith("claude_history:") ? conversation.source.slice("claude_history:".length) : "";
      if (!org) throw Error("请重新导入 Claude 标题以确认工作区 / Rescan Claude history");
      const raw = await this.request(`/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages`);
      const record = object(raw);
      if (!Array.isArray(record.chat_messages) || record.has_more === true) return fail();
      return this.receipt(await claudeImporter.normalize({ ...record, uuid: id, name: conversation.title } as ClaudeConversation, await importRevision(raw)), conversation);
    }
    const messages: DraftMessage[] = [], seen = new Set<string>(), cursors = new Set<string>();
    let cursor = "", page = 0;
    do {
      this.check();
      if (cursors.has(cursor) || ++page > 10000) throw Error("正文分页未完成，请重试 / Message pagination stalled");
      cursors.add(cursor);
      let next: string | undefined, batch: DraftMessage[];
      if (platform === "gemini") {
        const data = await this.request("/app", [`c_${id}`, 100, cursor || null, 1, [0], [4], null, 1], "hNvQHb");
        batch = array(at(data, 0)).slice().reverse().flatMap(turn => {
          const question = at(turn, 2, 0, 0), turnId = string(at(turn, 0, 1));
          if (typeof question !== "string" || !turnId) return fail();
          const candidates = array(at(turn, 3, 0) ?? []), chosen = at(turn, 3, 3);
          const answer = chosen ? candidates.find(candidate => at(candidate, 0) === chosen) : candidates[0];
          if (chosen && !answer) return fail();
          const createdAt = sourceTimestamp(at(turn, 4, 0));
          return [{ id: `${turnId}:u`, role: "user" as const, content: question, createdAt }, ...(answer ? [{ id: string(at(answer, 0)) || fail(), role: "assistant" as const, content: text(at(answer, 1)), createdAt }] : [])];
        });
        next = more(undefined, at(data, 1));
      } else if (platform === "deepseek") {
        const data = object(object(object(await this.request(`/api/v0/chat/history_messages?chat_session_id=${id}${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`)).data).biz_data);
        let items = rows(data.chat_messages ?? data.messages);
        // The history endpoint returns a tree, including abandoned/regenerated
        // answers. Match the website's current_message_id path, not every row.
        const currentId = object(data.chat_session).current_message_id;
        if (currentId != null || items.some(row => Object.hasOwn(row, "parent_id"))) {
          const byId = new Map(items.map(row => [string(row.message_id ?? row.id), row]));
          let node = currentId == null ? items.reduce((last, row) => {
            const id = string(row.message_id ?? row.id);
            return /^\d+$/u.test(id) && /^\d+$/u.test(last) ? BigInt(id) > BigInt(last) ? id : last : id;
          }, "") : string(currentId);
          const branch: Row[] = [], visited = new Set<string>();
          while (node) {
            if (visited.has(node) || !byId.has(node)) throw Error("DeepSeek 当前分支不完整，未覆盖已保存内容。");
            visited.add(node); const row = byId.get(node)!; branch.unshift(row); node = row.parent_id == null ? "" : string(row.parent_id);
          }
          items = branch;
        }
        batch = items.map(row => {
          const role = string(row.role).toLowerCase();
          if (role !== "user" && role !== "assistant") return fail();
          const fragments = row.fragments == null ? [] : rows(row.fragments);
          const fragmentText = fragments.filter(fragment => role === "user" ? fragment.type === "REQUEST" : fragment.type === "RESPONSE" || fragment.type === "TEMPLATE_RESPONSE").map(fragment => text(fragment.content)).filter(value => value.trim()).join("\n\n");
          // Empty fragment arrays do not mean an empty message. Some history
          // responses store the same message's readable body in content/text.
          const bodyText = text(row.content);
          const content = fragmentText || (bodyText.trim() ? bodyText : text(row.text));
          return { id: string(row.message_id ?? row.id) || fail(), role, content, createdAt: sourceTimestamp(row.inserted_at ?? row.created_at) };
        });
        next = more(data.has_more, data.next_cursor);
      } else if (platform === "kimi") {
        const data = object(await this.request("/apiv2/kimi.gateway.chat.v1.ChatService/ListMessages", { chatId: id, pageSize: 100, pageToken: cursor }));
        batch = rows(data.messages ?? []).slice().reverse().flatMap(row => {
          const role = string(row.role).toLowerCase();
          if (!/^(user|assistant|human|bot)$/u.test(role)) return fail();
          return [{ id: string(row.id ?? row.messageId ?? row.message_id) || fail(), role: /user|human/u.test(role) ? "user" as const : "assistant" as const, content: text(rows(row.blocks ?? []).map(block => block.text ?? block.content)), createdAt: sourceTimestamp(row.createTime ?? row.created_at) }];
        });
        next = more(undefined, data.nextPageToken ?? data.next_page_token);
      } else if (platform === "qwen" && this.source.origin !== "https://chat.qwen.ai") {
        const data = object(object(await this.request(`/api/v1/session/msg/list?session_id=${id}&page_size=100&page=${page}&return_response_messages=true&event_filter=all${cursor ? `&pos=${encodeURIComponent(cursor)}` : ""}`)).data);
        const items = rows(data.list);
        batch = items.slice().reverse().flatMap(row => {
          const key = string(row.req_id ?? row.pos) || fail(), createdAt = sourceTimestamp(row.created_at ?? row.createTime);
          const answers = row.response_messages ?? row.qwen_response_messages;
          if (!Array.isArray(answers)) return fail();
          return [{ id: `${key}:u`, role: "user" as const, content: text(row.request_messages), createdAt }, { id: `${key}:a`, role: "assistant" as const, content: text(answers), createdAt }];
        });
        const flag = data.has_next_page ?? data.have_next_page ?? data.have_more_record;
        if (typeof flag !== "boolean") return fail();
        next = more(flag, data.next_page_pos ?? items.at(-1)?.pos);
      } else if (platform === "qwen") {
        const data = object(object(await this.request(`/api/v2/chats/${id}?direction=up&limit=100${cursor ? `&last_id=${encodeURIComponent(cursor)}` : ""}`)).data);
        const chat = object(data.chat ?? data), history = object(chat.history);
        const mapping = object(history.messages);
        let items: Row[];
        if (Object.keys(mapping).length) {
          items = []; const visited = new Set<string>(); let node = string(history.currentId ?? chat.currentId);
          if (!node) return fail();
          while (node) { if (visited.has(node)) return fail(); visited.add(node); const row = object(mapping[node]); if (!row.id) return fail(); items.unshift(row); node = string(row.parentId); }
        } else items = rows(chat.messages ?? data.messages);
        batch = items.flatMap(row => { const role = row.role; if (role !== "user" && role !== "assistant") return []; return [{ id: string(row.id ?? row.message_id ?? row.messageId) || fail(), role, content: text(row.content), createdAt: sourceTimestamp(row.timestamp ?? row.created_at) }]; });
        next = more(data.has_more, data.next_cursor ?? data.next_id);
      } else {
        const pageData = doubaoHistoryBody(await this.request("/im/chain/single", this.imBody(3100, "pull_singe_chain_uplink_body", { conversation_id: id, anchor_index: cursor ? doubaoInteger(cursor, "anchor_index") : 9007199254740991, conversation_type: 3, direction: 1, limit: 100, ext: {}, filter: { index_list: [] } })), "pull_singe_chain_downlink_body");
        const items = doubaoRows(pageData.messages, "messages");
        batch = items.slice().reverse().map(row => {
          let content = text(row.content);
          if (typeof row.content === "string") { try { content = text(JSON.parse(row.content)); } catch { /* Plain text payload. */ } }
          if (Array.isArray(row.content_block)) content = rows(row.content_block).filter(block => block.block_type === 10000 || block.block_type === 10052).map(block => text(object(block.content).text_block ?? object(block.content).attachment_block)).filter(Boolean).join("\n\n") || content;
          const userType = doubaoInteger(row.user_type, "user_type");
          if (userType !== "1" && userType !== "2") throw Error("豆包消息角色无法识别，未覆盖已保存正文。");
          return { id: string(row.message_id) || fail(), role: userType === "1" ? "user" as const : "assistant" as const, content, createdAt: sourceTimestamp(row.create_time) };
        });
        if (doubaoHasMore(pageData.has_more ?? pageData.hasMore)) {
          if (!items.length) throw Error("豆包仍有更早消息，但当前分页为空，未将正文标为完整。");
          const indexes = items.map(row => BigInt(doubaoInteger(row.index_in_conv ?? row.index_in_conversation ?? row.index, "index_in_conv")));
          const minimum = indexes.reduce((a, b) => a < b ? a : b);
          if (minimum <= BigInt(0)) throw Error("豆包正文分页位置无效，未将正文标为完整。");
          next = String(minimum - BigInt(1));
        }
      }
      const fresh = batch.filter(message => { if (!message.id || seen.has(message.id)) return false; seen.add(message.id); return true; });
      if (next && !fresh.length) throw Error("正文分页重复，尚未读完 / Repeated message page");
      messages.unshift(...fresh); cursor = next ?? "";
    } while (cursor);
    if (!messages.length) throw Error("未读取到对话正文，已保留原内容 / Missing message text; saved content retained");
    const missing = messages.findIndex(message => !message.content.trim());
    if (missing >= 0) throw Error(`第 ${missing + 1} 条${messages[missing].role === "user" ? "用户消息" : "AI 回答"}未解析出正文（消息 ${messages[missing].id?.slice(0, 80)}），已保留原内容 / Missing message text; saved content retained`);
    return this.receipt(await captureFromDrafts({ ...conversation, sourceRevision: await importRevision(messages) }, messages), conversation);
  }
  private receipt(capture: ConversationCapture, original: Conversation): ConversationCapture {
    if (!capture.messages.length || capture.conversation.id !== original.id) return fail();
    return { ...capture, conversation: { ...original, ...capture.conversation, source: original.source, sourceAccount: this.source.account, nativeHistorySourceId: this.source.id, historyCoverage: "complete" } };
  }
}
