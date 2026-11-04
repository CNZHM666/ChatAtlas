import type { FocusSession } from "../shared/focus-session";
import { validateProjectState, type ProjectState } from "../shared/project-state";
import type { ProjectOriginalSource } from "./project-sources";

export const isProjectDraftValidationFailure = (error: unknown) => error instanceof Error && /Project claim has no supplied evidence|Invalid project (?:state|module|record|relationship|status|history)|Invalid module interface|Incomplete project/iu.test(error.message);

/** Wire aliases are navigation only. Persist canonical source IDs, never guesses. */
export function projectEvidenceAliases(sources: Array<{ id: string }>) {
  let prefix = "s";
  while (sources.some(source => new RegExp(`^${prefix}\\d+$`, "u").test(source.id))) prefix = `x${prefix}`;
  const aliases = new Map(sources.map((source, index) => [source.id, `${prefix}${index + 1}`]));
  const originals = new Map([...aliases].map(([id, alias]) => [alias, id]));
  const map = (value: unknown, ids: Map<string, string>): unknown => {
    if (Array.isArray(value)) return value.map(item => map(item, ids));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      ["evidenceIds", "beforeEvidenceIds", "reasonEvidenceIds", "confirmationEvidenceIds", "workEvidenceIds"].includes(key) && Array.isArray(item)
        ? item.map(id => typeof id === "string" ? ids.get(id) ?? id : id) : map(item, ids)]));
  };
  return { id: (id: string) => aliases.get(id) ?? id, encode: (value: unknown) => map(value, aliases), decode: (value: unknown) => map(value, originals) };
}

/** Invalid individual facts never become established facts or poison sound peers.
 * The strict validator remains authoritative; an entirely rejected plan fails. */
export function validateProjectDraft(value: unknown, sources: ProjectOriginalSource[], session: FocusSession): ProjectState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return validateProjectState(value, sources, session);
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.modules) || !Array.isArray(row.relations)) return validateProjectState(value, sources, session);
  const base = { summary: row.summary, modules: [], relations: [], decisions: [], constraints: [], actions: [], questions: [], history: [] };
  validateProjectState(base, sources, session);
  const kept: Record<string, unknown[]> = { modules: [], relations: [], decisions: [], constraints: [], questions: [], history: [] };
  const notes: NonNullable<ProjectState["reviewNotes"]> = [];
  let supplied = 0;
  let collectionError: string | undefined;
  for (const field of Object.keys(kept)) {
    const records = row[field] === undefined ? [] : row[field];
    const limit = field === "relations" ? 512 : field === "modules" ? 256 : field === "history" ? 32 : 128;
    if (!Array.isArray(records) || records.length > limit) {
      supplied++;
      const reason = !Array.isArray(records) ? `Invalid project records: ${field} must be an array` : `Invalid project records: ${field} exceeds ${limit} items`;
      collectionError ??= reason;
      notes.push({ key: field, category: "source_or_format", reason });
      continue;
    }
    for (const [index, item] of records.entries()) {
      supplied++;
      try { validateProjectState({ ...base, ...kept, [field]: [...kept[field], item] }, sources, session); kept[field].push(item); }
      catch (error) { notes.push({ key: `${field}:${index}`, category: "source_or_format", reason: error instanceof Error ? error.message : "Invalid project fact" }); }
    }
  }
  if (supplied && !Object.values(kept).some(items => items.length)) throw new Error(collectionError ?? "Project claim has no supplied evidence; no valid facts retained");
  const result = validateProjectState({ ...base, ...kept }, sources, session);
  return { ...result, ...(notes.length ? { reviewNotes: notes } : {}) };
}
