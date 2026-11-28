import type { FocusSession } from "../shared/focus-session";
import { wikiSections } from "../shared/wiki-navigation";
import { wikiExportEdition, type WikiEdition } from "../shared/wiki-reading-edition";
import type { ProjectExportSelection } from "./project-document";

export const PROJECT_EXPORT_PRESETS = [
  { id: "brief", label: { zh: "精简", en: "Brief" }, summary: {
    zh: "保留正文、核心决定与待决事项，隐藏引用标记与检查说明，适合阅读或换 AI 续聊。",
    en: "Clean prose, key decisions, and open questions with citations and diagnostics hidden.",
  } },
  { id: "handoff", label: { zh: "开发", en: "Handoff" }, summary: {
    zh: "保留技术规范、当前进展、已定决策与简洁来源定位，适合交给开发者或 Codex。",
    en: "Technical specs, confirmed decisions, and compact locators ready for developers or Codex.",
  } },
  { id: "archive", label: { zh: "审计", en: "Audit" }, summary: {
    zh: "保留完整总览、归属标记、引用定位、参考示例与集中展示的自动检查详情。",
    en: "Full overview, attribution marks, source locators, examples, and consolidated audit notes.",
  } },
] as const satisfies readonly { id: WikiEdition; label: { zh: string; en: string }; summary: { zh: string; en: string } }[];

/** A selected writing preference controls the next export. The draft keeps the mode in which it was written. */
export function defaultProjectExportPreset(session: FocusSession): WikiEdition | undefined {
  const ledger = session.wikiKnowledge;
  if (ledger?.documentType === "learning") return undefined;
  return wikiExportEdition(session.sidecarWritingMode ?? ledger?.draft?.writingMode ?? ledger?.writingMode)
    ?? (ledger?.draft ? "handoff" : undefined);
}

/** Chapter selection survives a preset change. Legacy records are included only when requested in Audit. */
export function projectExportSelection(session: FocusSession, preset = defaultProjectExportPreset(session),
  options: { wikiIds?: readonly string[]; hasReferences?: boolean; previous?: ProjectExportSelection } = {},
): ProjectExportSelection {
  const { previous, hasReferences } = options;
  const wikiIds = options.wikiIds ?? wikiSections(session).filter(page => page.body.trim()).map(page => page.id);
  return {
    overview: true,
    wikiIds: [...(previous?.wikiIds.length ? previous.wikiIds : wikiIds)],
    preset,
    sourceMode: preset === "archive" ? "excerpts" : "locators",
    sources: false,
    referenceAppendix: preset === "archive" && hasReferences !== false ? true : "omit",
    holderMarks: previous?.holderMarks ?? true,
    matters: preset === "archive" && Boolean(previous?.matters),
    history: preset === "archive" && Boolean(previous?.history),
  };
}
