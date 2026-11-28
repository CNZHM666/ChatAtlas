import type { FocusSession } from "./focus-session";

// These fields move the reader, but cannot alter source interpretation or article prose.
const NAVIGATION = new Set(["activeSectionId", "visitedSectionIds", "wikiCollapsedGroups", "updatedAt"]);
/** Workspace updates replace content fields by reference, while navigation can shallow-copy the session. */
export function sameProjectReadingInputs(before: FocusSession, after: FocusSession) {
  if (before === after) return true;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)] as Array<keyof FocusSession>);
  return [...keys].every(key => NAVIGATION.has(key) || Object.is(before[key], after[key]));
}

function sectionFingerprint(session: FocusSession): string {
  let out = `${session.sections.length}|${session.wikiKnowledge?.decisionsAt ?? ""}|`;
  for (const section of session.sections) {
    out += `${section.id}:${section.title.length}:${section.body.length}:${section.body.slice(0, 24)}:${section.body.slice(-24)}:${section.claims?.length ?? 0}:${section.userEdited ? 1 : 0};`;
  }
  out += `|${session.evidence.length}|`;
  for (const ref of session.evidence) {
    out += `${ref.id}:${ref.excerpt.length}:${ref.excerpt.slice(0, 16)}:${ref.excerpt.slice(-16)};`;
  }
  return out;
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
  let lastSession: FocusSession | undefined;
  let lastFingerprint = "";
  let tokens: unknown[] = [];
  const values = new Map<string, unknown>();
  return {
    has(session: FocusSession, key: string): boolean {
      if (!lastSession || !values.has(key)) return false;
      const fingerprint = sectionFingerprint(session);
      return fingerprint === lastFingerprint && (lastSession === session || sameProjectReadingInputs(lastSession, session));
    },
    get<T>(session: FocusSession, key: string, compute: () => T): T {
      const fingerprint = sectionFingerprint(session);
      const fastHit = Boolean(
        lastSession
        && fingerprint === lastFingerprint
        && (lastSession === session || sameProjectReadingInputs(lastSession, session)),
      );
      if (!fastHit) {
        const next = contentTokens(session);
        if (fingerprint !== lastFingerprint || tokens.length !== next.length || next.some((value, at) => !Object.is(value, tokens[at]))) {
          values.clear();
          tokens = next;
        }
        lastSession = session;
        lastFingerprint = fingerprint;
      }
      if (values.has(key)) return values.get(key) as T;
      const value = compute();
      values.set(key, value);
      return value;
    },
  };
}

export type ProjectReadingCache = ReturnType<typeof createProjectReadingCache>;
