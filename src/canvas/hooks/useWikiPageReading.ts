import { startTransition, useEffect, useRef, useState } from "react";
import type { FocusSession } from "../../shared/focus-session";
import { sameProjectReadingInputs } from "../../shared/project-reading-cache";
import type { ProjectWikiPages, WikiPageTarget } from "../project-wiki-pages";
import { readWikiPages } from "../wiki-reading-background";

/** Cache each page independently while navigating or reading a source. */
export function useWikiPageReading(session: FocusSession | undefined, zh: boolean, target: WikiPageTarget = "pages") {
  const basis = useRef<FocusSession>();
  if (session && (!basis.current || !sameProjectReadingInputs(basis.current, session))) basis.current = session;
  const source = session && basis.current;
  const [results, setResults] = useState<Partial<Record<WikiPageTarget,{source: FocusSession; zh: boolean; value?: Partial<ProjectWikiPages>}>>>({});
  const result = results[target];
  const eligible = source?.mode === "work" && Boolean(source.wikiKnowledge) && typeof Worker !== "undefined";
  useEffect(() => {
    if (!source || !eligible || result?.source === source && result.zh === zh) return;
    const controller = new AbortController();
    void Promise.resolve(readWikiPages(source, zh, controller.signal, target)).then(value => {
      if (!controller.signal.aborted) startTransition(() => setResults(previous => ({ ...previous, [target]: { source, zh, value } })));
    });
    return () => controller.abort();
  }, [source, zh, eligible, result, target]);
  if (!eligible) return undefined;
  if (result?.source === source && result.zh === zh) return result.value;
  // Keep the active page and its controls mounted while a verdict refreshes its projection.
  return result?.source.id === source.id && result.zh === zh ? result.value ?? null : null;
}
