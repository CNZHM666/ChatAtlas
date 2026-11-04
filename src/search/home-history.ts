import type { FocusEvidence } from "../shared/focus-session";
import type { Conversation, ConversationMessage, ConversationSemanticProfile } from "../shared/types";
import { readableConversationText } from "../shared/conversation-text";
import { messageFullTextSearch } from "./message-fulltext";
import { normalizeSearch, queryTerms, searchExcerpt } from "./query";
import { analyzedVersion } from "../ai/conversation-profiler";
import { matchesMessageQuery, messageSearchTokens, planMessageQuery } from "./message-query";
import type { MessageSourceRange, ReaderSearchHit } from "../shared/message-location";

export { historyRequest, type HistoryIntent } from "./history-request";
import { rankedMessages } from "./ranked-messages";

/** Require every topic anchor; common project words and synonyms cannot qualify a result. */
export function historySearchMatcher(query: string): (text: string) => number {
  const anchors = normalizeSearch(query).replace(/的|讨论过|在哪里/gu, " ").match(/[a-z0-9+#._-]+|[\p{Script=Han}]+/gu) ?? [];
  const groups = anchors.map(anchor => ({ anchor, terms: queryTerms(anchor), word: /^[a-z0-9+#._-]+$/u.test(anchor) ? new RegExp(`(?<![a-z0-9])${anchor.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![a-z0-9])`, "u") : undefined }));
  return text => {
    const haystack = normalizeSearch(text);
    if (!groups.length) return 0;
    let total = 0;
    for (const { anchor, terms, word } of groups) {
      if (word ? word.test(haystack) : haystack.includes(anchor)) { total += 60; continue; }
      if (!/^[\p{Script=Han}]+$/u.test(anchor) || !terms.length) return 0;
      const ratio = terms.filter(term => haystack.includes(term)).length / terms.length;
      if (ratio < .8) return 0;
      total += ratio * 35;
    }
    return total / groups.length;
  };
}

function historyExcerpt(query: string, content: string): string {
  const plain = readableConversationText(content)
    .replace(/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/gmu, "")
    .replace(/^[ \t]*(?:[-=_─━]{3,}|\|[\s:|-]+\|)[ \t]*$/gmu, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/^[ \t]*(?:#{1,6}\s*|[-*+]\s+|\d+\.\s+)/gmu, "")
    .replace(/[`*_]+/gu, "").replace(/[-=_─━]{4,}/gu, " ");
  return searchExcerpt(query, plain);
}

export interface HistoryMatch { conversation: Conversation; messages: ConversationMessage[]; excerpt: string; score: number; sourceRange?: MessageSourceRange; hits?:ReaderSearchHit[] }
/** Keyword lookup never invokes a model or an embedding provider. Only imported IDs may appear. */
export async function findHistory(query: string, conversations: Conversation[]): Promise<{ matches: HistoryMatch[]; capped: boolean }> {
  const plan = planMessageQuery(query);
  const rank = (text: string) => plan.search && matchesMessageQuery(plan, new Set(messageSearchTokens(text)), text) ? historySearchMatcher(plan.search)(text) || 35 : 0;
  const byId = new Map(conversations.map(conversation => [conversation.id, conversation]));
  // The same ranking as the sidebar's search, more of it kept: a conversation lists all its matching messages.
  const first = query.length >= 2 ? await rankedMessages(query, { limit: 100, conversationIds: [...byId.keys()] }) : undefined;
  const second = first && first.total > 100 ? await messageFullTextSearch.search(query, { requireBodyMatch: true, proximity: 120, limit: 80, offset: 100, conversationIds: [...byId.keys()] }) : undefined;
  const hits = [...first?.hits ?? [], ...second?.hits ?? []];
  const messages = hits.map(hit => hit.message);
  const matches = new Map<string, HistoryMatch>();
  for (const conversation of conversations) {
    const score = rank(conversation.title);
    if (score) matches.set(conversation.id, { conversation, messages: [], excerpt: "", score: score + 12 });
  }
  for (const message of messages) {
    const conversation = byId.get(message.conversationId);
    if (!conversation) continue;
    const hit = hits.find(hit => hit.messageId === message.id)!;
    const score = hit.score;
    const row: HistoryMatch = matches.get(conversation.id) ?? { conversation, messages: [], excerpt: "", score: 0 };
    if (!row.messages.length) row.sourceRange = hit.sourceRange;
    row.messages.push(message);
    (row.hits??=[]).push({messageId:message.id,excerpt:hit.summary,sourceRange:hit.sourceRange});
    if (!row.excerpt || score > row.score) row.excerpt = historyExcerpt(query, hit.summary || message.content);
    row.score = Math.max(row.score, score);
    matches.set(conversation.id, row);
  }
  return { matches: [...matches.values()].sort((a, b) => b.score - a.score || b.conversation.updatedAt - a.conversation.updatedAt), capped: messages.length === 180 };
}

export interface HistoryCandidate { sourceRevisions?:Record<string,string>; evidence?:FocusEvidence[]; title: string; kind: "project" | "review"; sourceIds: string[]; basis: "analysis" | "titles" | "recommendation"; reason?: string }
const genericTitleTopic = /^(?:设计要求|设计需求|功能规划|功能设计|方向推荐|实验代码|代码修改|代码优化|项目开发|项目设计|开发计划|技术方案|问题解决)$/u;
/** A substring is a matching anchor, not necessarily a complete topic. */
function titleTopicBoundary(topic: string, title: string): boolean {
  if (!/^[\p{Script=Han}]+$/u.test(topic)) return true;
  const segments = [...new Intl.Segmenter("zh-CN", { granularity: "word" }).segment(title)];
  const boundaries = new Set(segments.flatMap(part => [part.index, part.index + part.segment.length]));
  let at = title.indexOf(topic);
  while (at >= 0) {
    if (boundaries.has(at) && boundaries.has(at + topic.length)) return true;
    at = title.indexOf(topic, at + 1);
  }
  return false;
}
/** Four-character anchors group titles; expand them before presenting a topic name. */
function sharedTitlePhrase(anchor: string, titles: string[]): string {
  const words = titles[0]?.match(/[\p{Script=Han}]{3,}/gu) ?? [];
  let phrase = anchor;
  for (const word of words.filter(item => item.includes(anchor))) {
    for (let length = Math.min(word.length, 32); length > phrase.length; length--) {
      let found = false;
      for (let start = 0; start <= word.length - length; start++) {
        const candidate = word.slice(start, start + length);
        if (candidate.includes(anchor) && titles.every(title => title.includes(candidate))) {
          phrase = candidate;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }
  return phrase;
}
export function discoverHistory(conversations: Conversation[], profiles: ConversationSemanticProfile[]): HistoryCandidate[] {
  const groups = new Map<string, HistoryCandidate>();
  const add = (title: string, source: Conversation, basis: HistoryCandidate["basis"], intent = "") => {
    title = title.trim();
    if (title.length < 3 || title.length > 32 || /^(?:项目|讨论|学习|开发|方案|历史|功能|什么|how|what|the)$/iu.test(title)) return;
    const key = title.normalize("NFKC").toLocaleLowerCase();
    const kind = /学习|复习|课程|知识|教程|原理|learn|study|course/iu.test(`${intent} ${source.title}`) ? "review" : "project";
    const group = groups.get(key) ?? { title, kind, sourceIds: [], basis };
    if (!group.sourceIds.includes(source.id)) group.sourceIds.push(source.id);
    if (basis === "analysis") group.basis = basis;
    groups.set(key, group);
  };
  for (const source of conversations) {
    const profile = profiles.find(item => item.conversationId === source.id && item.analysisSource === "ai" && item.analyzedVersion === analyzedVersion(source));
    if (profile) for (const title of [...profile.topics, ...profile.concepts].slice(0, 8)) add(title, source, "analysis", profile.intent);
    else {
      const words = source.title.match(/[A-Za-z][A-Za-z0-9_.+#-]{2,}|[\p{Script=Han}]{3,}/gu) ?? [];
      for (const word of words) {
        if (/^[\p{Script=Han}]{5,}$/u.test(word)) for (let offset = 0; offset <= word.length - 4; offset++) add(word.slice(offset, offset + 4), source, "titles");
        else add(word, source, "titles");
      }
    }
  }
  const titlesById = new Map(conversations.map(source => [source.id, source.title]));
  for (const group of groups.values()) {
    if (group.basis === "titles" && group.sourceIds.length >= 2 && /^[\p{Script=Han}]+$/u.test(group.title)) {
      group.title = sharedTitlePhrase(group.title, group.sourceIds.map(id => titlesById.get(id)!));
    }
  }
  const candidates: HistoryCandidate[] = [];
  for (const group of [...groups.values()].filter(item => item.sourceIds.length >= 2 && (item.basis === "analysis" || !genericTitleTopic.test(item.title) && item.sourceIds.filter(id => titleTopicBoundary(item.title, titlesById.get(id)!)).length >= 2)).sort((a, b) => Number(b.basis === "analysis") - Number(a.basis === "analysis") || b.sourceIds.length - a.sourceIds.length || b.title.length - a.title.length)) {
    if (candidates.some(item => group.sourceIds.filter(id => item.sourceIds.includes(id)).length / Math.max(item.sourceIds.length, group.sourceIds.length) >= .8)) continue;
    candidates.push(group);
    if (candidates.length >= 8) break;
  }
  return candidates;
}
