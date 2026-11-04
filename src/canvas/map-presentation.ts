import type { FocusSection } from "../shared/focus-session";
import type { UnderstandingEdge } from "./understanding-model";
import type { ProjectRecord } from "../shared/project-state";

export interface MapGroup { id: string; title: string; items: FocusSection[] }
export type MapPresentation = "architecture" | "flow" | "comparison" | "hierarchy";

/** Choose an explanation from saved relationships, never from guessed chapter keywords. */
export function mapPresentation(edges: UnderstandingEdge[], architecture = false): MapPresentation {
  if (architecture) return "architecture";
  const supported = edges.filter(edge => !edge.uncertain);
  if (supported.length && supported.every(edge => edge.kind === "comparison")) return "comparison";
  if (supported.some(edge => ["flow", "feedback"].includes(edge.kind)) && !supported.some(edge => edge.kind === "contains")) return "flow";
  return "hierarchy";
}

/** Only saved module/phase names define product boundaries. Connectivity is layout, not a product role. */
export function architectureGroups(nodes: Array<FocusSection & { layer?: string }>): MapGroup[] {
  const named = new Map<string, MapGroup>();
  for (const node of nodes) if (node.layer?.trim() || node.phase?.trim()) {
    const title = (node.layer?.trim() || node.phase!.trim()).normalize("NFKC").replace(/\s+/gu, " ");
    // Normalize notation only, never merge different business meanings or
    // invent layers for unnamed nodes. Keep the user's original display name.
    const key = title.toLowerCase().replace(/\s*[&＆]\s*/gu, "与")
      .replace(/(?:层|板块|分组)$/u, "").replace(/\s+(?:layer|group)$/u, "").replace(/\s+/gu, "") || title.toLowerCase();
    if (!named.has(key)) named.set(key, { id: `layer:${key}`, title, items: [] });
    named.get(key)!.items.push(node);
  }
  return [...named.values()];
}

/** Only records that explicitly name a module are associated with it. Shared citations are not a link. */
export function moduleRecords<T extends ProjectRecord>(title: string, records: T[]): T[] {
  const key = title.normalize("NFKC").trim().toLowerCase();
  if (key.length < 2) return [];
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = /^[a-z0-9 _-]+$/iu.test(key) ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "iu") : undefined;
  return records.filter(record => {
    const text = `${record.text}\n${record.reason}\n${record.quote}`.normalize("NFKC").toLowerCase();
    return pattern ? pattern.test(text) : text.includes(key);
  });
}
