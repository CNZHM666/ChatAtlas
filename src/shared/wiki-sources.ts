import { conversationPlatformGroup, platformName } from "./platforms";
import { wikiLedgerUnits, type WikiConversationSpan, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiSourceConversation } from "./wiki-knowledge";

/** What a conversation gives about itself: its platform, title and the platform's own times. */
export interface WikiSourceInput { id: string; platform: string; title: string; sourceCreatedAt?: number; sourceUpdatedAt?: number }

/** A real platform time: an invalid epoch or a time in the future is none. */
const plausible = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value >= Date.UTC(2000, 0, 1) && value <= Date.now() + 86_400_000;
function spanOf(conversation: WikiSourceInput): WikiConversationSpan {
  const start = plausible(conversation.sourceCreatedAt) ? conversation.sourceCreatedAt : undefined;
  const end = plausible(conversation.sourceUpdatedAt) && (start === undefined || conversation.sourceUpdatedAt >= start) ? conversation.sourceUpdatedAt : undefined;
  return { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) };
}

/** A conversation whose platform gave no start time (DeepSeek's list gives only the last update) began no later than its
 * first dated message. Without a start, which of two conversations came later cannot be told, and an earlier AI's plan
 * was kept over a later conversation's decision. */
export function datedWikiSources<T extends WikiSourceInput>(sources: T[], messages: Array<{ conversationId: string; sourceCreatedAt?: number }>): T[] {
  return sources.map(source => {
    if (plausible(source.sourceCreatedAt)) return source;
    const first = messages.filter(message => message.conversationId === source.id && plausible(message.sourceCreatedAt)).reduce<number | undefined>((earliest, message) => earliest === undefined || message.sourceCreatedAt! < earliest ? message.sourceCreatedAt : earliest, undefined);
    return first === undefined ? source : { ...source, sourceCreatedAt: first };
  });
}

/** The ledger with its source conversations named, and each unit's evidence given its conversation's span, so which of
 * two conversations came later can be told. A conversation not given keeps what the ledger had. */
export function withWikiSources(ledger: WikiKnowledgeLedger, conversations: WikiSourceInput[]): WikiKnowledgeLedger {
  const sources: Record<string, WikiSourceConversation> = { ...ledger.sources };
  for (const conversation of conversations) sources[conversation.id] = { platform: conversation.platform, title: conversation.title, ...spanOf(conversation) };
  const spanned = (unit: WikiKnowledgeUnit): WikiKnowledgeUnit => {
    const source = sources[unit.evidence.conversationId];
    if (!source || source.start === undefined && source.end === undefined) return unit;
    return { ...unit, evidence: { ...unit.evidence, conversationSpan: { ...(source.start !== undefined ? { start: source.start } : {}), ...(source.end !== undefined ? { end: source.end } : {}) } } };
  };
  return { ...ledger, sources, batches: ledger.batches.map(batch => ({ ...batch, units: batch.units.map(spanned) })) };
}

/** How two units' messages are ordered. In one conversation, by message order; across conversations, only when one was
 * over before the other began, by the platforms' own times: a conversation taken up again later overlaps the other,
 * and its message numbers say nothing about another conversation's. Positive: a came later. undefined: cannot tell. */
export function wikiDiscussionOrder(a: WikiKnowledgeUnit, b: WikiKnowledgeUnit): number | undefined {
  if (a.evidence.conversationId === b.evidence.conversationId) return a.evidence.messageIndex - b.evidence.messageIndex;
  const x = a.evidence.conversationSpan, y = b.evidence.conversationSpan;
  if (x?.start !== undefined && y?.end !== undefined && x.start >= y.end) return 1;
  if (y?.start !== undefined && x?.end !== undefined && y.start >= x.end) return -1;
  return undefined;
}
/** newer was said after older, as far as can be told. */
export const wikiSaidLater = (newer: WikiKnowledgeUnit, older: WikiKnowledgeUnit) => (wikiDiscussionOrder(newer, older) ?? 0) > 0;
/** A sort in discussion order, earliest first: by message within a conversation, by the conversations' start across
 * them; conversations with no start time keep their order. Never by message numbers of two conversations. */
export function wikiByDiscussion(a: WikiKnowledgeUnit, b: WikiKnowledgeUnit): number {
  const known = wikiDiscussionOrder(a, b);
  if (known !== undefined) return known;
  const x = a.evidence.conversationSpan?.start, y = b.evidence.conversationSpan?.start;
  return x !== undefined && y !== undefined ? x - y : 0;
}

/** A source conversation as the document names it: by the AI it was held with ("DeepSeek"), numbered by when it began only
 * when one AI held several ("ChatGPT 2"), then its title. A code like "C2" made readers look it up; the AI's own name does not.
 * Only a document with more than one conversation names them; with one there is nothing to tell apart. */
export interface WikiSourceLabel { id: string; label: string; order: number; platform: string; title: string; start?: number; end?: number }
export function wikiSourceLabels(ledger: WikiKnowledgeLedger | undefined, conversationIds: string[], locale: string): Map<string, WikiSourceLabel> {
  const ids = [...new Set(conversationIds)];
  if (ids.length < 2) return new Map();
  const ordered = ids.map((id, index) => ({ id, index, source: ledger?.sources?.[id] }))
    .sort((a, b) => (a.source?.start ?? Infinity) - (b.source?.start ?? Infinity) || a.index - b.index);
  const named = ordered.map(({ source }) => source ? platformName(source.platform, locale) : "");
  const seen = new Map<string, number>();
  return new Map(ordered.map(({ id, source }, index) => {
    const platform = named[index], shared = named.filter(name => name === platform).length > 1, nth = (seen.get(platform) ?? 0) + 1;
    seen.set(platform, nth);
    const label = !platform ? locale === "en" ? `Conversation ${index + 1}` : `对话 ${index + 1}` : shared ? `${platform} ${nth}` : platform;
    return [id, { id, label, order: index, platform, title: source?.title ?? "", ...(source?.start !== undefined ? { start: source.start } : {}), ...(source?.end !== undefined ? { end: source.end } : {}) }];
  }));
}
/** The name a reader sees: the AI's name already says which AI it was. */
export const wikiSourceName = (label: WikiSourceLabel) => label.label;
/** The AI that proposed a unit ("Claude"), when the units come from more than one AI platform: only then does it tell
 * the writer anything. The user's own words have no platform. */
export function wikiUnitPlatform(ledger: WikiKnowledgeLedger, locale: string): (unit: WikiKnowledgeUnit) => string | undefined {
  const used = new Set(wikiLedgerUnits(ledger).map(unit => unit.evidence.conversationId));
  const platforms = new Set([...used].flatMap(id => ledger.sources?.[id] ? [conversationPlatformGroup(ledger.sources[id].platform)] : []));
  if (platforms.size < 2) return () => undefined;
  return unit => {
    const source = ledger.sources?.[unit.evidence.conversationId];
    return source && unit.evidence.role === "assistant" ? platformName(source.platform, locale) : undefined;
  };
}
