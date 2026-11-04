import { baseConversation, captureFromDrafts, importRevision, isRecord, sourceTimestamp, type DraftMessage, type PlatformImporter } from "./types";

/** DeepSeek data export: conversations.json with a ChatGPT-like mapping tree whose
 * messages carry typed fragments (REQUEST, RESPONSE, THINK, SEARCH). */
interface DeepSeekFragment { type?: string; content?: string }
interface DeepSeekNode { id?: string; parent?: string | null; children?: string[]; message?: { fragments?: DeepSeekFragment[]; inserted_at?: string } | null }
export interface DeepSeekConversation { id?: string; title?: string; inserted_at?: string; updated_at?: string; mapping?: Record<string, DeepSeekNode> }

export const looksLikeDeepSeek = (item: unknown) => isRecord(item) && isRecord(item.mapping)
  && Object.values(item.mapping).some(node => isRecord(node) && isRecord(node.message) && Array.isArray(node.message.fragments));

/** Follow the latest child at each turn: regenerated answers append a sibling. */
function activePath(mapping: Record<string, DeepSeekNode>): DeepSeekNode[] {
  const nodes = Object.entries(mapping).map(([key, node]) => ({ ...node, id: node.id ?? key }));
  const root = nodes.find(node => !node.parent || !mapping[node.parent]);
  const path: DeepSeekNode[] = [];
  const seen = new Set<string>();
  for (let current = root; current && !seen.has(current.id!); current = current.children?.length ? nodes.find(node => node.id === current!.children!.at(-1)) : undefined) { seen.add(current.id!); path.push(current); }
  return path;
}

export const deepseekImporter: PlatformImporter<DeepSeekConversation> = {
  platform: "deepseek",
  describe(raw) {
    if (typeof raw.id !== "string" || !raw.id) throw new Error("DeepSeek conversation is missing its ID.");
    if (!isRecord(raw.mapping)) throw new Error("DeepSeek conversation is missing its message mapping.");
    const createdAt = sourceTimestamp(raw.inserted_at);
    return baseConversation({ id: `deepseek:${raw.id}`, platform: "deepseek", source: "deepseek_export", title: raw.title ?? "", createdAt, updatedAt: sourceTimestamp(raw.updated_at) ?? createdAt });
  },
  revision: importRevision,
  async normalize(raw, revision, capturedAt) {
    const conversation = { ...deepseekImporter.describe(raw), sourceRevision: revision };
    const drafts = activePath(raw.mapping ?? {}).flatMap((node): DraftMessage[] => {
      const fragments = node.message?.fragments ?? [];
      const at = sourceTimestamp(node.message?.inserted_at);
      // THINK and SEARCH fragments are process; only the request and answer are discussion.
      const text = (type: string) => fragments.filter(item => item?.type === type && typeof item.content === "string").map(item => item.content!).join("\n\n");
      return [
        ...(text("REQUEST") ? [{ id: `${node.id}:u`, role: "user" as const, content: text("REQUEST"), createdAt: at }] : []),
        ...(text("RESPONSE") ? [{ id: `${node.id}:a`, role: "assistant" as const, content: text("RESPONSE"), createdAt: at }] : []),
      ];
    });
    return captureFromDrafts(conversation, drafts, capturedAt);
  },
};
