import { contextKnowledge } from "./context-fixture";
import { sourceMessageSignature } from "../shared/source-signature";
import { projectHistorySignature, projectHistorySourceSignature } from "../shared/project-history";
import { projectStateSignature, type ProjectHistoryEvent } from "../shared/project-state";

/** Test and isolated visual QA only; not a seed for the user's actual database. */
export function evolutionKnowledge() {
  const knowledge = contextKnowledge(), session = knowledge.session;
  const texts = ["最初决定数据库使用 SQLite。", "数据库改成 IndexedDB，保留每条消息的独立 ID，因为浏览器本地存储更合适。", "决定引入 Orama 进行消息全文检索。", "决定为搜索索引增加持久化与中断恢复。", "之前考虑过服务器定时同步方案，现在决定放弃，因为要坚持本地优先。"];
  knowledge.messages = texts.map((content, index) => ({ id: `evolution-message-${index}`, conversationId: "c", role: "user" as const, messageIndex: [0, 4, 11, 19, 27][index], content, preview: "", contentHash: "", createdAt: Date.UTC(2026, 8, 1 + index * 5), updatedAt: Date.UTC(2026, 8, 1 + index * 5) }));
  session.evidence = knowledge.messages.map((message, index) => ({ id: `evolution-ref-${index}`, messageId: message.id, conversationId: message.conversationId, title: "ChatAtlas 技术方案讨论", excerpt: message.content, sourceSignature: sourceMessageSignature(message.content) }));
  session.sourceSignatures = { c: Object.fromEntries(knowledge.messages.map(message => [message.id, sourceMessageSignature(message.content)])) };
  session.sourceRoles = { c: Object.fromEntries(knowledge.messages.map(message => [message.id, message.role])) };
  session.sourceMessageOrder = { c: knowledge.messages.map(message => message.id) };
  session.projectState!.decisions = [{ id: "db", text: "数据库使用 SQLite", reason: "初始选择", status: "documented", quote: texts[0], evidenceIds: ["evolution-ref-0"] }];
  session.projectState!.actions = []; session.projectState!.modules = []; session.projectState!.constraints = [];
  session.projectMaintenance = { decisions: { db: { text: "数据库使用 SQLite", confirmed: true } } };
  session.sections = [{ id: "database", title: "数据库最初方案", body: "数据库使用 SQLite", kind: "finding", transition: "", evidenceIds: ["evolution-ref-0"] }];
  session.projectState!.signature = projectStateSignature(session);
  const event = (index: number, area: string, changeKind: ProjectHistoryEvent["changeKind"], title: string, after: string, before = "", beforeIndex = index): ProjectHistoryEvent => ({ id: `history:step-${index}`, title, area, changeKind, decisionStatus: "confirmed", version: "", after, before, beforeQuote: before ? texts[beforeIndex] : "", beforeEvidenceIds: before ? [`evolution-ref-${beforeIndex}`] : [], status: "documented", reason: "", quote: texts[index], evidenceIds: [`evolution-ref-${index}`], discussedAt: knowledge.messages[index].createdAt });
  const events = [event(0, "数据库选型", "adopt", "最初采用 SQLite", "数据库使用 SQLite"), event(1, "数据库选型", "change", "调整为 IndexedDB", "数据库使用 IndexedDB", "数据库使用 SQLite", 0), event(2, "历史搜索", "add", "引入 Orama", "使用 Orama 进行消息全文检索"), event(3, "历史搜索", "add", "索引持久化与恢复", "搜索索引支持持久化与中断恢复"), event(4, "同步策略", "retire", "放弃服务器定时同步", "放弃服务器定时同步方案", "曾考虑服务器定时同步", 4)];
  Object.assign(events[1], { reason: "浏览器本地存储更合适", reasonQuote: "因为浏览器本地存储更合适。", reasonEvidenceIds: ["evolution-ref-1"] });
  Object.assign(events[4], { reason: "坚持本地优先", reasonQuote: "因为要坚持本地优先。", reasonEvidenceIds: ["evolution-ref-4"] });
  session.projectHistoryAnalysis = { version: 4, signature: projectHistorySignature(session), sourceSignature: projectHistorySourceSignature(session, knowledge.messages), events, evidence: [...session.evidence], sources: knowledge.messages.map((message, index) => ({ id: session.evidence[index].id, conversationId: message.conversationId, messageId: message.id, role: message.role, messageIndex: message.messageIndex, discussedAt: message.createdAt, signature: sourceMessageSignature(message.content) })), generatedAt: Date.UTC(2026, 9, 12) };
  knowledge.conversations[0].messageCount = 5;
  return knowledge;
}
