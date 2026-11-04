import type { FocusSession } from "./focus-session";
import { wikiQuoteRange } from "./wiki-claims";

/** Original message order wins over unreliable timestamps inside a conversation. */
export function orderHistoryMessages<T extends { conversationId: string; messageIndex: number; offset?: number; createdAt?: number; discussedAt?: number }>(items: T[]): T[] {
  const queues = new Map<string, T[]>();
  for (const item of items) {
    const queue=queues.get(item.conversationId);
    if(queue)queue.push(item);else queues.set(item.conversationId,[item]);
  }
  for (const queue of queues.values()) queue.sort((a, b) => a.messageIndex - b.messageIndex || (a.offset ?? 0) - (b.offset ?? 0));
  const pending = [...queues.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id,queue])=>({id,queue,at:0}));
  const result: T[] = [];
  while (pending.some(item => item.at<item.queue.length)) {
    const available = pending.filter(item => item.at<item.queue.length);
    available.sort((left,right) => {
      const first = historyTime(left.queue[left.at].createdAt ?? left.queue[left.at].discussedAt), second = historyTime(right.queue[right.at].createdAt ?? right.queue[right.at].discussedAt);
      return first !== undefined && second !== undefined ? first - second || left.id.localeCompare(right.id) : left.id.localeCompare(right.id);
    });
    result.push(available[0].queue[available[0].at++]);
  }
  return result;
}
export interface HistoryPosition { conversationId: string; messageId: string; messageIndex: number; offset?: number; discussedAt?: number }
export function historyTime(value?: number) { return value !== undefined && Number.isFinite(value) && value > 946684800000 ? value : undefined; }
/** Unknown cross-conversation order must never silently replace a confirmed choice. */
export function compareHistoryPositions(a?: HistoryPosition, b?: HistoryPosition): number | undefined {
  if (!a || !b) return undefined;
  if (a.conversationId === b.conversationId) {
    if (a.messageIndex !== b.messageIndex) return a.messageIndex - b.messageIndex;
    if (a.messageId === b.messageId && a.offset !== undefined && b.offset !== undefined) return a.offset - b.offset;
    return undefined;
  }
  const first = historyTime(a.discussedAt), second = historyTime(b.discussedAt);
  return first !== undefined && second !== undefined && first !== second ? first - second : undefined;
}
export function historyProofPosition(session: FocusSession, sources: Array<{ id: string; text: string; conversationId?: string; messageId?: string; messageIndex?: number; discussedAt?: number }>, proof: { quote: string; evidenceIds: string[] }): HistoryPosition | undefined {
  for (const id of proof.evidenceIds) {
    const source = sources.find(item => item.id === id && wikiQuoteRange(item.text, proof.quote));
    const ref = session.evidence.find(item => item.id === id);
    const conversationId = source?.conversationId ?? ref?.conversationId, messageId = source?.messageId ?? ref?.messageId;
    if (!source || !conversationId || !messageId) continue;
    const savedIndex = session.sourceMessageOrder?.[conversationId]?.indexOf(messageId);
    const messageIndex = source.messageIndex ?? (savedIndex !== undefined && savedIndex >= 0 ? savedIndex : undefined);
    if (messageIndex === undefined) continue;
    return { conversationId, messageId, messageIndex, offset: wikiQuoteRange(source.text, proof.quote)!.start, discussedAt: source.discussedAt };
  }
  return undefined;
}
