import { useEffect, useRef, useState } from "react";
import type { FocusSession } from "../../shared/focus-session";
import { sameProjectReadingInputs } from "../../shared/project-reading-cache";
import type { ProjectWikiPages } from "../project-wiki-pages";
import { readWikiPages } from "../wiki-reading-background";

/** Keep the two page projections while navigating or reading a source. */
export function useWikiPageReading(session: FocusSession | undefined, zh: boolean) {
  const basis = useRef<FocusSession>();
  if (!session || !basis.current || !sameProjectReadingInputs(basis.current, session)) basis.current = session;
  const source = basis.current;
  const [result, setResult] = useState<{ source: FocusSession; zh: boolean; value?: ProjectWikiPages }>();
  const eligible = source?.mode === "work" && Boolean(source.wikiKnowledge) && typeof Worker !== "undefined";
  useEffect(() => {
    if (!source || !eligible) return;
    const controller = new AbortController();
    void Promise.resolve(readWikiPages(source, zh, controller.signal)).then(value => {
      if (!controller.signal.aborted) setResult({ source, zh, value });
    });
    return () => controller.abort();
  }, [source, zh, eligible]);
  if (!eligible) return undefined;
  if (result?.source === source && result.zh === zh) return result.value;
  // Keep the active page and its controls mounted while a verdict refreshes its projection.
  return result?.source.id === source.id && result.zh === zh ? result.value ?? null : null;
}
