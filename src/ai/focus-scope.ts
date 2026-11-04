import type { Conversation, ConversationMessage, ConversationGraph, QuestionSnapshot } from "../shared/types";
import type { FocusScope, FocusScopeBlock, FocusSession } from "../shared/focus-session";
import type { TranscriptPassage } from "../search/transcript-index";
import { matchingTerms } from "../search/transcript-index";
import { intentTerms } from "./knowledge-source-retrieval";
import { sourceMessageSignature } from "../shared/source-signature";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";
import { getDatabase } from "../storage/db";
import { sourceReviewOutline } from "../canvas/source-review-outline";

export interface FocusScopeCandidate extends FocusScopeBlock {
  id: string;
  sourceTitle: string;
  excerpt: string;
  characters: number;
  text: string;
  recommended: boolean;
  background: boolean;
}

const followUp = /^(?:那(?:第[一二三]|另一个方法|这种|这个)|这个|那个|这[种样些]|它|上述|前面|刚才|继续|再解释|举(?:个|一个)例子|(?:能|可以)(?:再)?举|比如呢|例如呢|然后呢|接着呢|所以呢|怎么理解[？?\s]*$|什么意思[？?\s]*$|为什么[？?\s]*$|为啥[？?\s]*$|that |this |it |why(?: is that| so)?[?\s]*$|continue|another example|can you (?:give an example|explain it))/iu;

/** Local discovery keeps whole question/answer turns and dependent follow-ups. */
export function buildFocusScopeCandidates(goal: string, source: Conversation, input: ConversationMessage[], reviews: FocusSession[] = [], graph?: ConversationGraph, snapshots: QuestionSnapshot[] = []): FocusScopeCandidate[] {
  const messages = input.filter((item) => item.content.trim() && !isInternalSearchQueryMessage(item)).sort((a, b) => a.messageIndex - b.messageIndex);
  const rawTerms = intentTerms(goal);
  const terms = rawTerms.filter((term) => !/^(?:the|and|only|want|to|all|my|please|review|study|how|what|why|do|does|can|is|are|a|an|i|复习|只想|想要|全部)$/iu.test(term)
    && (rawTerms[0] === term || !/^(?:系统|问题|内容|方法|概念|理解|知识|学习|项目|使用|操作)$/u.test(term)));
  const savedOutline = sourceReviewOutline(source.id, messages, reviews).outline;
  const outline = savedOutline?.messageSignatures ? savedOutline : undefined;
  const chapterByMessage = new Map((outline?.chapters ?? []).flatMap((chapter) => chapter.messageIds.map((id) => [id, chapter.title] as const)));
  const snapshotByMessage = new Map(snapshots.filter((item) => item.conversationId === source.id).map((item) => [item.questionId, item]));
  const nodeByMessage = new Map((graph?.nodes ?? []).filter((item) => item.role === "user" && item.sourceMessageId).map((item) => [item.sourceMessageId!, item]));
  const groups: ConversationMessage[][] = [];
  for (const message of messages) {
    if (!groups.length || message.role === "user" && !followUp.test(message.content.trim())) groups.push([]);
    groups.at(-1)!.push(message);
  }
  return groups.map((group): FocusScopeCandidate => {
    const first = group.find((item) => item.role === "user") ?? group[0];
    const snapshot = snapshotByMessage.get(first.id);
    // Cached titles are hints only. Evidence matching always includes current text.
    const node = nodeByMessage.get(first.id);
    const authoredTitle = node?.displayTitleSource === "user" ? node.displayTitle ?? node.title : undefined;
    const title = (authoredTitle || first.content.replace(/\s+/gu, " ").replace(/^[#>*\s]+/u, "")).slice(0, 110);
    const text = group.map((item) => item.content).join("\n");
    const answer = group.find((item) => item.role === "assistant");
    const validHint = snapshot?.sourceHash === `${first.contentHash}:${answer?.contentHash ?? ""}:full-v2` ? `${snapshot.displayTitle} ${snapshot.summary} ${snapshot.concepts.join(" ")}` : "";
    const direct = matchingTerms(text, terms).length > 0;
    const background = !direct && matchingTerms(`${chapterByMessage.get(first.id) ?? ""} ${validHint} ${authoredTitle ?? ""}`, terms).length > 0;
    const hit = group.find((item) => matchingTerms(item.content, terms).length) ?? first;
    const match = terms.map((term) => hit.content.toLocaleLowerCase().indexOf(term.toLocaleLowerCase())).find((index) => index >= 0);
    const start = Math.max(0, (match ?? 0) - 70);
    return { id: JSON.stringify([source.id, first.id]), conversationId: source.id, sourceTitle: source.title, title,
      messageIds: group.map((item) => item.id), messageSignatures: Object.fromEntries(group.map((item) => [item.id, sourceMessageSignature(item.content)])),
      excerpt: hit.content.slice(start, start + 240), text, characters: text.length, recommended: direct || background, background };
  });
}

export async function discoverFocusScope(goal: string, sources: Conversation[], signal: AbortSignal): Promise<FocusScopeCandidate[]> {
  const db = await getDatabase();
  const reviews = (await db.getAll("focusSessions")).filter(session => !session.deletedAt && !session.ledgerTest);
  const result: FocusScopeCandidate[] = [];
  for (const source of sources) {
    signal.throwIfAborted();
    const [messages, graph, snapshots] = await Promise.all([db.getAllFromIndex("messages", "by-conversation", source.id), db.get("conversationGraphs", source.id), db.getAllFromIndex("questionSnapshots", "by-conversation", source.id)]);
    result.push(...buildFocusScopeCandidates(goal, source, messages, reviews, graph, snapshots));
  }
  signal.throwIfAborted();
  return result;
}

export function confirmedFocusScope(candidates: FocusScopeCandidate[], ids: Set<string>): FocusScope {
  return { kind: "goal", blocks: candidates.filter((item) => ids.has(item.id)).map(({ conversationId, title, messageIds, messageSignatures }) => ({ conversationId, title, messageIds, messageSignatures })) };
}

/** Never expand a confirmed range or silently analyze changed source text. */
export function scopedFocusPassages(passages: TranscriptPassage[], scope: FocusScope): TranscriptPassage[] {
  if (scope.kind === "all") return passages;
  if (!scope.blocks?.length) throw new Error("请选择要整理的讨论板块 / Select discussion topics to organize.");
  const bySource = new Map<string, Map<string, string>>();
  for (const block of scope.blocks) {
    const selected = bySource.get(block.conversationId) ?? new Map<string, string>();
    for (const id of block.messageIds) {
      const signature = block.messageSignatures[id];
      if (!signature) throw new Error("整理范围已失效，请重新确认 / Confirm the discussion scope again.");
      selected.set(id, signature);
    }
    bySource.set(block.conversationId, selected);
  }
  const picked = passages.filter((item) => bySource.get(item.document.conversationId)?.has(item.evidence.messageId));
  const found = new Map(picked.map((item) => [JSON.stringify([item.document.conversationId, item.evidence.messageId]), item]));
  for (const [source, messages] of bySource) for (const [id, signature] of messages) {
    const passage = found.get(JSON.stringify([source, id]));
    if (!passage || sourceMessageSignature(passage.text) !== signature) throw new Error("来源正文已变化，请重新确认整理范围 / Source text changed. Confirm the discussion scope again.");
  }
  if (!picked.length) throw new Error("没有可阅读的来源 / No readable source material.");
  return picked;
}
