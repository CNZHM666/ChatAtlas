/** Which model handles a task, and how many requests may run at once.
 * Reading original passages is high-volume extraction: the economy model fits.
 * Directory planning and Wiki writing decide the result's structure and prose:
 * they need the main model, and retries on a weaker model cost more than they save. */

// Wiki planning tasks are "other" tasks, which otherwise default to the economy model.
const MAIN_MODEL_PRESENTATIONS = new Set(["wiki_revision_sources", "wiki_revision_batch", "wiki_topic_plan", "wiki_subject_plan", "wiki_chapter_write", "wiki_topic_content", "wiki_content_plan", "wiki_directory", "wiki_topic_impact", "wiki_title_edit", "wiki_directory_names", "wiki_chapter_opening", "wiki_project_overview", "wiki_topic_overlap_audit", "wiki_subtopic_placement_audit", "wiki_chapter_merge"]);

export function usesMainModelForPlanning(taskType: string | undefined, data: Record<string, unknown> | undefined) {
  return taskType === "other" && MAIN_MODEL_PRESENTATIONS.has(String(data?.presentation));
}

export function isReadingRequest(taskType: string | undefined, data: Record<string, unknown> | undefined) {
  const coverage = data?.coverage as { stage?: string; final?: boolean } | undefined;
  return taskType === "focus_session" && coverage?.stage === "reading" && !coverage.final;
}

// First-party and large hosted APIs accept more parallel requests than an
// unknown gateway; 429 responses still halve the level immediately.
const HIGH_LIMIT_HOSTS = [
  "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com", "api.deepseek.com", "api.moonshot.cn", "api.moonshot.ai",
  "open.bigmodel.cn", "api.z.ai", "api.siliconflow.cn", "api.siliconflow.com", "ark.cn-beijing.volces.com", "openrouter.ai",
  "dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "api.minimaxi.com", "api.minimax.io",
];
export const DEFAULT_CONCURRENCY = 3;
// High-limit hosts: reading 55 batches at six requests left each batch queued
// about 22 s of its 49 s; a rate limit still halves and holds the level.
export const MAX_CONCURRENCY = 10;

export function providerConcurrencyCeiling(baseUrl: string): number {
  try { const host = new URL(baseUrl).hostname; return HIGH_LIMIT_HOSTS.includes(host) || host.endsWith(".maas.aliyuncs.com") ? MAX_CONCURRENCY : DEFAULT_CONCURRENCY; } catch { return DEFAULT_CONCURRENCY; }
}

/** Additive increase, multiplicative decrease: start at the default, add one slot
 * after a run of successes, halve on a rate limit and hold one slot for a minute. */
export class AdaptiveConcurrency {
  private level: number;
  private streak = 0;
  private holdUntil = 0;
  constructor(readonly ceiling: number, private readonly growAfter = 2) { this.level = Math.min(DEFAULT_CONCURRENCY, ceiling); }
  current(now = Date.now()) { return now < this.holdUntil ? 1 : this.level; }
  success() { if (++this.streak >= this.growAfter && this.level < this.ceiling) { this.level++; this.streak = 0; } }
  rateLimited(now = Date.now()) { this.level = Math.max(1, Math.floor(this.level / 2)); this.streak = 0; this.holdUntil = now + 60_000; }
}
