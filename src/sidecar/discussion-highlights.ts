import type { FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationGraph, ConversationMessage } from "../shared/types";
import { sourceMessageSignature } from "../shared/source-signature";
import { isInternalSearchQueryMessage, readableConversationText } from "../shared/conversation-text";
import { historyTime } from "../shared/history-order";
import { readerQuestionIndex } from "../canvas/reader-position";
import { getDatabase } from "../storage/db";
import { getMessagesForConversation } from "../storage/messages";
import { discussionHighlightId, type DiscussionHighlightEdit } from "../storage/discussion-highlights";

export interface DiscussionHighlight {
  id: string;
  conversationId: string;
  messageId: string;
  platformMessageId?:string;
  messageIds: string[];
  signatures: Record<string, string>;
  title: string;
  category: string;
  kind: "discussion" | "question" | "change" | "personal";
  firstTurn: number;
  lastTurn: number;
  discussedAt?: number;
  personal?: boolean;
  categoryEdited?: boolean;
  categoryAmbiguous?:boolean;
  stale?: boolean;
}
export interface DiscussionStage {id:string;title:string;firstTurn:number;lastTurn:number;questionIds:string[];personal?:boolean}
export interface DiscussionHighlights {
  stages?:DiscussionStage[];
  rows: DiscussionHighlight[];
  totalTurns: number;
  coveredTurns: number;
  needsUpdate: boolean;
  partial: boolean;
}

const projections = new Map<string, { key: string; result: DiscussionHighlights }>();
const pending = new Map<string, Promise<DiscussionHighlights>>();
let cacheEpoch = 0;
/** Derived in-memory projections only. Restores and source edits invalidate via fresh metadata. */
export function clearDiscussionHighlightCache() { projections.clear(); pending.clear(); cacheEpoch++; }
export function discussionTitle(value: string): string {
  return readableConversationText(value).replace(/^[\s#>*`-]+/u, "").replace(/\s+/gu, " ").trim().slice(0, 120);
}
export function discussionMessageSignature(message: ConversationMessage): string {
  return sourceMessageSignature(JSON.stringify([message.content, message.role, message.messageIndex, message.replyToMessageId ?? ""]));
}

/** Original questions and explicit reply ownership are shared with the Reader. */
export function discussionGroups(messages: ConversationMessage[]) {
  const ordered = [...messages].filter(message => !isInternalSearchQueryMessage(message)).sort((a, b) => a.messageIndex - b.messageIndex);
  const owners = readerQuestionIndex(ordered);
  const grouped = new Map<string, ConversationMessage[]>();
  for (const message of ordered) { const owner = owners.get(message.id); if (owner) { const group = grouped.get(owner) ?? []; group.push(message); grouped.set(owner, group); } }
  return ordered.filter(message => message.role === "user").map((question, index) => ({ question, turn: index + 1, messages: grouped.get(question.id) ?? [question] }));
}

/** Pure projection: Wiki topic order never determines the original discussion order. */
export function buildDiscussionHighlights(conversation: Conversation, messages: ConversationMessage[], sessions: FocusSession[], edits: DiscussionHighlightEdit[], graph?: ConversationGraph): DiscussionHighlights {
  const groups = discussionGroups(messages), byMessage = new Map(messages.map(message => [message.id, message]));
  const groupByMessage = new Map(groups.flatMap(group => group.messages.map(message => [message.id, group] as const)));
  const hashes = new Map(messages.map(message => [message.id, sourceMessageSignature(message.content)]));
  const stageMap=new Map<string,DiscussionStage>();
  const topicOwnership=new Map<string,Set<string>>();
  const covered = new Set<string>(), candidates = new Map<string, DiscussionHighlight & { priority: number }>();
  let needsUpdate = false;
  const offer = (ids: string[], title: string, category = "", kind: DiscussionHighlight["kind"] = "discussion", priority = 1) => {
    // Split distant citations instead of inventing a continuous discussion between them.
    const turns = [...new Set(ids.flatMap(id => groupByMessage.get(id) ? [groupByMessage.get(id)!] : []))].sort((a, b) => a.turn - b.turn);
    const runs: typeof turns[] = [];
    for (const turn of turns) {
      const previous = runs.at(-1);
      if (previous && previous.at(-1)!.turn + 1 === turn.turn) previous.push(turn); else runs.push([turn]);
    }
    for (const run of runs) {
      const first = run[0], raw = run.flatMap(group => group.messages).sort((a, b) => a.messageIndex - b.messageIndex);
      const id = discussionHighlightId(conversation.id, first.question.id), previous = candidates.get(id);
      if (previous && previous.priority > priority) continue;
      candidates.set(id, { id, conversationId: conversation.id, messageId: first.question.id, ...(first.question.platformMessageId?{platformMessageId:first.question.platformMessageId}:{}), messageIds: raw.map(message => message.id), signatures: Object.fromEntries(raw.map(message => [message.id, discussionMessageSignature(message)])),
        title: discussionTitle(title) || discussionTitle(first.question.content), category: category.trim(), kind,
        firstTurn: first.turn, lastTurn: run.at(-1)!.turn, discussedAt: historyTime(first.question.sourceCreatedAt), priority });
    }
  };
  for (const session of [...sessions].filter(session => session.status !== "preview" && session.sourceConversationIds.includes(conversation.id)).sort((a, b) => a.updatedAt - b.updatedAt)) {
    const outline = session.sourceOutlines?.find(outline => outline.conversationId === conversation.id);
    const scopeIds = session.scope?.kind === "goal" ? new Set(session.scope.blocks?.filter(block => block.conversationId === conversation.id).flatMap(block => block.messageIds) ?? []) : undefined;
    const expectedOrder = session.sourceMessageOrder?.[conversation.id] ?? outline?.messageOrder;
    const actualOrder = messages.filter(message => expectedOrder?.includes(message.id)).sort((a, b) => a.messageIndex - b.messageIndex).map(message => message.id);
    const ordered = !expectedOrder || expectedOrder.filter(id => byMessage.has(id)).join("\0") === actualOrder.join("\0");
    const valid = (id: string, excerpt?: string, signature?: string) => {
      const raw = byMessage.get(id);
      if (!raw || scopeIds && !scopeIds.has(id) || !ordered) return false;
      const expected = signature ?? outline?.messageSignatures?.[id] ?? session.sourceSignatures?.[conversation.id]?.[id];
      const role = outline?.messageRoles?.[id] ?? session.sourceRoles?.[conversation.id]?.[id];
      if (role && raw.role !== role) return false;
      const question = groupByMessage.get(id)?.question;
      const questionSignature = question && (outline?.messageSignatures?.[question.id] ?? session.sourceSignatures?.[conversation.id]?.[question.id]);
      if (question && questionSignature && questionSignature !== hashes.get(question.id)) return false;
      return expected ? expected === hashes.get(id) : Boolean(excerpt?.trim() && raw.content.includes(excerpt.trim()));
    };
    const refs = session.evidence.filter(ref => ref.conversationId === conversation.id);
    const validRefsById=new Map(refs.filter(ref=>valid(ref.messageId,ref.excerpt,ref.sourceSignature)).map(ref=>[ref.id,ref]));
    const ownersByMessage=new Map<string,Set<FocusSession["sections"][number]>>();
    for(const section of session.sections)for(const id of section.evidenceIds){
      const ref=validRefsById.get(id);if(!ref)continue;
      const owners=ownersByMessage.get(ref.messageId)??new Set<FocusSession["sections"][number]>();owners.add(section);ownersByMessage.set(ref.messageId,owners);
    }
    const sectionFor = (ids: string[]) => {
      const counts=new Map<FocusSession["sections"][number],number>();
      for(const id of new Set(ids))for(const owner of ownersByMessage.get(id)??[])counts.set(owner,(counts.get(owner)??0)+1);
      const ranked=[...counts].map(([section,count])=>({section,count})).sort((a,b)=>b.count-a.count);
      const best=ranked[0];if(!best)return;
      const topic=(section:FocusSession["sections"][number])=>(section.wikiGroup||section.wikiDisplayTitle||section.title).trim().normalize("NFKC").toLocaleLowerCase();
      // Overlapping citations with different owners are ambiguous. Do not let
      // the first Wiki page in storage decide the category by accident.
      return ranked.some(item=>item.count===best.count&&topic(item.section)!==topic(best.section))?undefined:best.section;
    };
    const topicFor=(section:ReturnType<typeof sectionFor>)=>section?.wikiGroup?.trim()||section?.wikiDisplayTitle||section?.title||"";
    for(const group of groups){
      const owner=topicFor(sectionFor(group.messages.map(message=>message.id)));if(!owner)continue;
      const topics=topicOwnership.get(group.question.id)??new Set<string>();topics.add(owner);topicOwnership.set(group.question.id,topics);
    }
    for (const chapter of outline?.chapters ?? []) {
      const ids = chapter.messageIds.filter(id => !scopeIds || scopeIds.has(id));
      if (!ids.length) continue;
      if (!ids.every(id => valid(id))) { needsUpdate = true; continue; }
      ids.forEach(id => { const group = groupByMessage.get(id); if (group) covered.add(group.question.id); });
      const section = sectionFor(ids);
      if(/^(?:阶段\s*[一二三四五六七八九十百0-9０-９]+|第.{1,8}阶段|phase\s+[a-z0-9]+|stage\s+[a-z0-9]+)/iu.test(chapter.title.trim())){
        const turns=[...new Set(ids.flatMap(id=>groupByMessage.get(id)?[groupByMessage.get(id)!]:[]))].sort((a,b)=>a.turn-b.turn);
        if(turns.length){
          const stageId=discussionHighlightId(conversation.id,turns[0].question.id);
          stageMap.set(stageId,{id:stageId,title:chapter.title,firstTurn:turns[0].turn,lastTurn:turns.at(-1)!.turn,questionIds:turns.map(turn=>turn.question.id)});
          // Reuse existing chapter coverage; retain distinct original questions
          // inside a phase instead of making the phase a single reading card.
          for(const turn of turns){const owner=sectionFor(turn.messages.map(message=>message.id));offer(turn.messages.map(message=>message.id),discussionTitle(turn.question.content),topicFor(owner),"discussion",2);}
        }
      }else offer(ids, chapter.title, topicFor(section), "discussion", 2);
    }
    for (const section of session.sections) {
      if (section.origin === "user") continue;
      const relevant = refs.filter(ref => section.evidenceIds.includes(ref.id) && (!scopeIds || scopeIds.has(ref.messageId)));
      const validRefs = relevant.filter(ref => valid(ref.messageId, ref.excerpt, ref.sourceSignature));
      if (validRefs.length !== relevant.length) { needsUpdate = true; continue; }
      validRefs.forEach(ref => { const group = groupByMessage.get(ref.messageId); if (group) covered.add(group.question.id); });
      const owningSection=sectionFor(validRefs.map(ref=>ref.messageId));
      offer(validRefs.map(ref => ref.messageId), section.wikiDisplayTitle || section.title, topicFor(owningSection), section.kind === "open_question" ? "question" : "discussion", 1);
    }
    // Event titles remain discussion navigation; no adoption/implementation inference.
    const analysis = session.projectEvolutionAnalysis ?? session.projectHistoryAnalysis;
    for (const event of analysis?.events ?? []) {
      if (session.projectMaintenance?.evolutionEvents?.[event.id]?.hidden) continue;
      const eventRefs = [...refs, ...(analysis?.evidence ?? []).filter(ref => ref.conversationId === conversation.id)].filter(ref => event.evidenceIds.includes(ref.id));
      const validRefs = eventRefs.filter(ref => valid(ref.messageId, event.quote, ref.sourceSignature));
      if (!validRefs.length || !event.quote || !validRefs.some(ref => byMessage.get(ref.messageId)?.content.includes(event.quote))) continue;
      validRefs.forEach(ref => { const group = groupByMessage.get(ref.messageId); if (group) covered.add(group.question.id); });
      offer(validRefs.map(ref => ref.messageId), event.title, event.area, "change", 3);
    }
  }
  if (graph?.chapters?.length) {
    const fresh = Boolean(graph.sourceHash && graph.sourceHash === messages.map(message => `${message.id}:${message.contentHash}`).join("|"));
    for (const chapter of graph.chapters) {
      if (!fresh && chapter.source !== "user" && !chapter.createdManually) { needsUpdate = true; continue; }
      const ids = chapter.questionIds.map(id => id.replace(/^conversation-message-/u, "")).filter(id => byMessage.get(id)?.role === "user");
      if (fresh) ids.forEach(id => covered.add(id));
      const turns=groups.filter(group=>ids.includes(group.question.id));
      if(turns.length){
        const stageId=discussionHighlightId(conversation.id,turns[0].question.id);
        if(chapter.source==="user"||chapter.createdManually||!stageMap.has(stageId))stageMap.set(stageId,{id:stageId,title:chapter.title,firstTurn:turns[0].turn,lastTurn:turns.at(-1)!.turn,questionIds:ids,personal:chapter.source==="user"||chapter.createdManually});
        for(const turn of turns){
          const existing=candidates.get(discussionHighlightId(conversation.id,turn.question.id));
          if(!existing)offer(turn.messages.map(message=>message.id),discussionTitle(turn.question.content),"",chapter.source==="user"?"personal":"discussion",1);
        }
      }
    }
  }
  for (const edit of edits.filter(edit => edit.conversationId === conversation.id)) {
    const existing = candidates.get(edit.id);
    if (edit.manual && !existing && edit.messageIds?.length) {
      offer(edit.messageIds, edit.title ?? "", edit.category, "personal", 5);
    }
    const item = candidates.get(edit.id);
    if (!item) continue;
    if (edit.hidden) { candidates.delete(edit.id); continue; }
    const stale = edit.manual && (!edit.signatures || Object.entries(edit.signatures).some(([id, signature]) => !byMessage.has(id) || discussionMessageSignature(byMessage.get(id)!) !== signature));
    candidates.set(edit.id, { ...item, title: edit.title || item.title, category: edit.category ?? item.category, categoryEdited:edit.category!==undefined,personal: Boolean(edit.manual || edit.title || edit.category), ...(stale ? { stale: true } : {}) });
  }
  for(const row of candidates.values()){
    if(row.categoryEdited)continue;
    const topics=topicOwnership.get(row.messageId);
    if(topics?.size===1)row.category=[...topics][0];
    else if(topics&&topics.size>1){row.category="";row.categoryAmbiguous=true;}
  }
  return { stages:[...stageMap.values()].sort((a,b)=>a.firstTurn-b.firstTurn), rows: [...candidates.values()].sort((a, b) => a.firstTurn - b.firstTurn).map(({ priority: _priority, ...row }) => { void _priority; return row; }), totalTurns: groups.length, coveredTurns: covered.size,
    needsUpdate, partial: conversation.hydrationState !== "hydrated" && conversation.importState !== "complete" };
}

/** Cache only local projections, scoped by source revision + saved analysis + personal edits. */
export async function loadDiscussionHighlights(conversation: Conversation, sessions: FocusSession[]): Promise<DiscussionHighlights> {
  const db = await getDatabase();
  const [graph, edits] = await Promise.all([db.get("conversationGraphs", conversation.id), db.getAllFromIndex("discussionHighlights", "by-conversation", conversation.id)]);
  const relevant = sessions.filter(session => session.status !== "preview" && session.sourceConversationIds.includes(conversation.id));
  const key = JSON.stringify([conversation, relevant.map(session => [session.id, session.updatedAt, session.scope, session.sourceOutlines?.filter(outline => outline.conversationId === conversation.id), session.sourceSignatures?.[conversation.id], session.sourceMessageOrder?.[conversation.id], session.sourceRoles?.[conversation.id], session.evidence.filter(ref => ref.conversationId === conversation.id), session.sections.map(section => [section.id, section.title, section.wikiDisplayTitle, section.wikiGroup, section.kind, section.origin, section.evidenceIds]), session.projectEvolutionAnalysis, session.projectHistoryAnalysis, session.projectMaintenance?.evolutionEvents]), graph?.updatedAt, graph?.sourceHash, graph?.chapters, edits]);
  const cached = projections.get(conversation.id);
  if (cached?.key === key) return cached.result;
  const epoch = cacheEpoch, jobKey = conversation.id + key;
  const existing = pending.get(jobKey); if (existing) return existing;
  const work = getMessagesForConversation(conversation.id, { cache: false }).then(messages => {
    const result = buildDiscussionHighlights(conversation, messages, relevant, edits, graph);
    if (cacheEpoch !== epoch) return result;
    projections.delete(conversation.id); projections.set(conversation.id, { key, result });
    while (projections.size > 24) projections.delete(projections.keys().next().value!);
    return result;
  }).finally(() => pending.delete(jobKey));
  pending.set(jobKey, work); return work;
}

/** Read selected originals afresh. Never publish an old projection over changed text. */
export async function readDiscussionHighlight(row: DiscussionHighlight): Promise<ConversationMessage[]> {
  const messages = await getMessagesForConversation(row.conversationId, { cache: false });
  const selected = row.messageIds.map(id => messages.find(message => message.id === id));
  if (selected.some(message => !message || discussionMessageSignature(message) !== row.signatures[message.id])) throw Error("HIGHLIGHT_SOURCE_CHANGED");
  return selected as ConversationMessage[];
}
