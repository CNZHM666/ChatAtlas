import type { FocusSession } from "./focus-session";

// These fields move the reader, but cannot alter source interpretation or article prose.
const NAVIGATION = new Set(["activeSectionId", "visitedSectionIds", "wikiCollapsedGroups", "updatedAt"]);
/** Workspace updates replace content fields by reference, while navigation can shallow-copy the session. */
export function sameProjectReadingInputs(before: FocusSession, after: FocusSession) {
  if (before === after) return true;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as Array<keyof FocusSession>);
  return [...keys].every(key => NAVIGATION.has(key) || Object.is(before[key], after[key]));
}
const record = (value: object) => Object.entries(value).flatMap(([key, item]) => [key, item]);
function contentTokens(session: FocusSession): unknown[] {
  return [
    ...Object.entries(session).filter(([key]) => !NAVIGATION.has(key)).flat(),
    // Keep direct editor/evidence changes visible even if a caller reused the array.
    ...session.sections.flatMap(section => [...record(section), ...(section.claims ?? []).flatMap(record)]),
    ...session.evidence.flatMap(record),
  ];
}

/** A workspace-owned cache. Navigation shares results; changing content, scope,
 * source receipts or verdicts invalidates them. No serialized ledgers or global retention. */
export function createProjectReadingCache() {
  let tokens: unknown[] = [];
  const values = new Map<string, unknown>();
  return {
    get<T>(session: FocusSession, key: string, compute: () => T): T {
      const next = contentTokens(session);
      if (tokens.length !== next.length || next.some((value, at) => !Object.is(value, tokens[at]))) {
        values.clear(); tokens = next;
      }
      if (values.has(key)) return values.get(key) as T;
      const value = compute(); values.set(key, value); return value;
    },
  };
}

export type ProjectReadingCache = ReturnType<typeof createProjectReadingCache>;
