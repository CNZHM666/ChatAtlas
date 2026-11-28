import type { FocusSession } from "./focus-session";
import type { WikiWritingMode } from "./wiki-knowledge";

export const WIKI_WRITING_MODES = {
  concise: { zh: "精简定稿", en: "Concise Wiki" },
  handoff: { zh: "开发规格", en: "Development spec" },
  audit: { zh: "完整审计", en: "Full audit" },
} as const satisfies Record<WikiWritingMode, { zh: string; en: string }>;

export function sidecarWritingMode(project: FocusSession): WikiWritingMode {
  return project.sidecarWritingMode ?? project.wikiKnowledge?.draft?.writingMode ?? project.wikiKnowledge?.writingMode ?? "concise";
}
