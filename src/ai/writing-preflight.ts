/** Local checks on a Wiki writing request before it is sent. A request that fails
 * one of these can never produce a valid result, so it is stopped here instead of
 * paying for the request, its repairs and its split retries. */

export interface WritingPayload {
  passages?: Array<{ id: string; wikiOwnerId?: string }>;
  wikiTopics?: Array<{ ownerId: string; subtopics?: Array<{ evidenceIds?: string[] }> }>;
}

export type WritingPreflightIssue = "empty_batch" | "empty_roster" | "unknown_owner" | "topic_without_material" | "unknown_subtopic_evidence";

export function writingPreflightIssue(payload: WritingPayload): WritingPreflightIssue | undefined {
  const passages = payload.passages ?? [], topics = payload.wikiTopics ?? [];
  if (!passages.length) return "empty_batch";
  if (!topics.length) return "empty_roster";
  const owners = new Set(topics.map(topic => topic.ownerId));
  if (passages.some(passage => !passage.wikiOwnerId || !owners.has(passage.wikiOwnerId))) return "unknown_owner";
  if (topics.some(topic => !passages.some(passage => passage.wikiOwnerId === topic.ownerId))) return "topic_without_material";
  const ids = new Set(passages.map(passage => passage.id));
  if (topics.some(topic => topic.subtopics?.some(subtopic => subtopic.evidenceIds?.some(id => !ids.has(id))))) return "unknown_subtopic_evidence";
  return undefined;
}

/** Not a provider validation error: recovery must not retry or split it. */
export class WikiPreflightError extends Error {
  readonly code: string;
  constructor(readonly issue: WritingPreflightIssue, zh: boolean) {
    super(zh ? `Wiki 正文批次没有通过发送前检查（${issue}），已在本地拦截，没有发送请求。已完成的批次已保留，请重试或反馈此问题。` : `A Wiki writing batch failed its pre-send check (${issue}) and was stopped locally without a request. Completed batches are kept; retry or report this issue.`);
    this.code = `WIKI_PREFLIGHT_${issue.toUpperCase()}`;
  }
}
