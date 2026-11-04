import { sourceMessageSignature } from "../../shared/source-signature";
import { baseConversation, captureFromDrafts, importRevision, isRecord, sourceTimestamp, type DraftMessage, type PlatformImporter } from "./types";

/** Google Takeout → My Activity → Gemini Apps, JSON format. Takeout stores one
 * activity per prompt without conversation IDs, so nearby prompts are grouped into
 * sessions. A session is a reading unit, not a claim about the original chat. */
interface GeminiActivity { header?: string; title?: string; time?: string; products?: string[]; safeHtmlItem?: Array<{ html?: string }> }
export interface GeminiSession { activities: GeminiActivity[] }

const SESSION_GAP_MS = 30 * 60_000;
// Takeout prefixes each prompt with a localized verb such as "Prompted".
const PROMPT_PREFIX = /^(?:Prompted|Asked|Sent|已提示|提示了|已发送|已询问|提问)[:：]?\s*/u;

export const looksLikeGeminiActivity = (item: unknown) => isRecord(item) && typeof item.time === "string" && typeof item.title === "string"
  && (typeof item.header === "string" && /gemini|bard/iu.test(item.header) || Array.isArray(item.products) && item.products.some(product => typeof product === "string" && /gemini|bard/iu.test(product)));

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'" };
const decodeEntities = (text: string) => text.replace(/&(#x[\da-f]+|#\d+|\w+);/giu, (match, name: string) => {
  if (name[0] === "#") { const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10); return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match; }
  return ENTITIES[name.toLowerCase()] ?? match;
});

/** Takeout answers are sanitized HTML. Workers have no DOMParser, so convert the
 * small set of structural tags to Markdown and drop the rest. */
export function geminiHtmlText(html: string): string {
  const code: string[] = [];
  const withCode = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/giu, (_, body: string) => { code.push(decodeEntities(body.replace(/<[^>]+>/gu, ""))); return `${code.length - 1}`; });
  const text = withCode
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<h([1-6])[^>]*>/giu, (_, level: string) => `\n\n${"#".repeat(Number(level))} `)
    .replace(/<li[^>]*>/giu, "\n- ")
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|table|tr|blockquote)>/giu, "\n\n")
    .replace(/<\/t[dh]>/giu, " | ")
    .replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/giu, "**$1**")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/giu, "`$1`")
    .replace(/<[^>]+>/gu, "");
  return decodeEntities(text).replace(/(\d+)/gu, (_, index: string) => `\n\n\`\`\`\n${code[Number(index)].replace(/\n+$/u, "")}\n\`\`\`\n\n`).replace(/\n{3,}/gu, "\n\n").trim();
}

/** Group newest-first activity into chronological sessions split by idle gaps. */
export function geminiSessions(activities: GeminiActivity[]): GeminiSession[] {
  const dated = activities.filter(item => sourceTimestamp(item.time) !== undefined).sort((a, b) => sourceTimestamp(a.time)! - sourceTimestamp(b.time)!);
  const sessions: GeminiSession[] = [];
  for (const activity of dated) {
    const last = sessions.at(-1)?.activities.at(-1);
    if (last && sourceTimestamp(activity.time)! - sourceTimestamp(last.time)! <= SESSION_GAP_MS) sessions.at(-1)!.activities.push(activity);
    else sessions.push({ activities: [activity] });
  }
  return sessions;
}

const prompt = (activity: GeminiActivity) => (activity.title ?? "").replace(PROMPT_PREFIX, "").trim();

export const geminiImporter: PlatformImporter<GeminiSession> = {
  platform: "gemini",
  describe(raw) {
    const first = raw.activities?.[0];
    const createdAt = sourceTimestamp(first?.time);
    if (!first || createdAt === undefined) throw new Error("Gemini activity is missing its time.");
    // The first prompt and time identify a session across repeated exports.
    const id = `gemini:${sourceMessageSignature(`${first.time}\n${first.title ?? ""}`)}`;
    const title = prompt(first).replace(/\s+/gu, " ").slice(0, 80) || "Gemini";
    return baseConversation({ id, platform: "gemini", source: "gemini_takeout", title, createdAt, updatedAt: sourceTimestamp(raw.activities.at(-1)?.time) ?? createdAt });
  },
  revision: importRevision,
  async normalize(raw, revision, capturedAt) {
    const conversation = { ...geminiImporter.describe(raw), sourceRevision: revision };
    const drafts = raw.activities.flatMap((activity): DraftMessage[] => {
      const at = sourceTimestamp(activity.time);
      const key = sourceMessageSignature(`${activity.time}\n${activity.title ?? ""}`);
      const answer = (activity.safeHtmlItem ?? []).map(item => typeof item?.html === "string" ? geminiHtmlText(item.html) : "").filter(Boolean).join("\n\n");
      return [{ id: `${key}:u`, role: "user", content: prompt(activity), createdAt: at }, ...(answer ? [{ id: `${key}:a`, role: "assistant" as const, content: answer, createdAt: at }] : [])];
    });
    return captureFromDrafts(conversation, drafts, capturedAt);
  },
};
