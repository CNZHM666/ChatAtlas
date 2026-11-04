import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { FocusSession } from "../../shared/focus-session";
import { applyUnderstanding, generateUnderstanding, UNDERSTANDING_VERSION, type UnderstandingAnalysisResult } from "../../ai/understanding-analysis";

export function useUnderstandingAnalysis(session: FocusSession | undefined, sessionRef: MutableRefObject<FocusSession | undefined>, save: (next: FocusSession) => Promise<void>, enabled: boolean) {
  const [running, setRunning] = useState(false), [error, setError] = useState("");
  const controller = useRef<AbortController>(), attempted = useRef<string>();
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    setRunning(false); setError("");
    return () => { controller.current?.abort(); controller.current = undefined; };
  }, [session?.id]);
  const analyze = useCallback(async () => {
    const base = sessionRef.current;
    if (!base || controller.current) return;
    const task = new AbortController(); controller.current = task; attempted.current = base.id;
    setRunning(true); setError("");
    const apply = async (result: UnderstandingAnalysisResult) => {
      task.signal.throwIfAborted();
      const latest = sessionRef.current;
      if (!latest || latest.id !== base.id) { task.abort(); return; }
      await saveRef.current(applyUnderstanding(latest, base, result));
    };
    try { await apply(await generateUnderstanding(base, task.signal, apply)); }
    catch (failure) {
      if (!task.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure));
        const latest = sessionRef.current;
        if (latest?.id === base.id) await saveRef.current({ ...latest, structureAnalysis: { status: "failed", version: UNDERSTANDING_VERSION, updatedAt: Date.now() } }).catch(() => undefined);
      }
    } finally {
      if (controller.current === task) controller.current = undefined;
      if (!task.signal.aborted) setRunning(false);
    }
  }, [sessionRef]);
  useEffect(() => {
    if (enabled && session?.structureAnalysis?.status === "pending" && attempted.current !== session.id) void analyze();
  }, [enabled, session?.id, session?.structureAnalysis?.status, analyze]);
  const cancel = useCallback(() => { controller.current?.abort(); controller.current = undefined; setRunning(false); }, []);
  return { analyze, running, error, cancel };
}
