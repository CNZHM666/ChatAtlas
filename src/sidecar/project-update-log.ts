import type { recordUiFailure } from "../canvas/ui-failure";
import type { UpdatePhase } from "./project-update-state";
import type { WikiProgress, WikiWritingEvent } from "../shared/wiki-knowledge";

const key = "atlas-sidecar-update-log-v1";
const limit = 24;
const stages = ["reading", "importing", "analyzing", "organizing", "confirming", "writing", "saving"] as const;
const states = ["started", "waiting", "finished", "partial", "failed"] as const;

export interface ProjectUpdateLogEntry {
  at: number;
  stage: UpdatePhase["stage"];
  state: typeof states[number];
  completed?: number;
  total?: number;
  smallerBatches?: boolean;
  code?: string;
  reason?: string;
  error?: ReturnType<typeof recordUiFailure>["name"];
  frames?: string[];
  fields?: string[];
  unmatchedCitations?: number;
  wikiStage?: WikiProgress["stage"];
  writingEvent?: WikiWritingEvent;
}

let latest: ProjectUpdateLogEntry[] = [];
let memoryOnly = false;

export function readProjectUpdateLog(): ProjectUpdateLogEntry[] {
  if (memoryOnly) return latest;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return Array.isArray(saved) ? saved.filter(row => row && Number.isFinite(row.at) && Math.abs(row.at) <= 8.64e15
      && stages.includes(row.stage) && states.includes(row.state)).slice(-limit) : [];
  } catch { /* A locked or unavailable storage area leaves the session log usable. */ }
  return latest;
}

export function appendProjectUpdateLog(entry: Omit<ProjectUpdateLogEntry, "at">): ProjectUpdateLogEntry[] {
  latest = [...readProjectUpdateLog(), { ...entry, at: Date.now() }].slice(-limit);
  if (!memoryOnly) {
    try { localStorage.setItem(key, JSON.stringify(latest)); } catch { memoryOnly = true; }
  }
  return latest;
}

export function updateValidationFields(error: unknown) {
  if (!error || typeof error !== "object" || !("fieldPaths" in error) || !Array.isArray(error.fieldPaths)) return undefined;
  const fields = error.fieldPaths.filter((path): path is string => typeof path === "string"
    && /^(?:changes(?:\.length|\[\d{1,2}\](?:\.(?:title|text|kind|target|operation))?)?|pages(?:\[\d{1,3}\])?(?:\.subtopics(?:\[\d{1,3}\])?)?(?:\.(?:title|question|group|sectionIds))?)$/u.test(path));
  return fields.length ? fields.slice(0, 8) : undefined;
}

export function updateDiagnosticCode(error: unknown, capture: boolean, detail: ReturnType<typeof recordUiFailure>) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (typeof code === "string" && /^(?:PROVIDER_|LOCAL_INPUT_|SIDECAR_|NETWORK_|RESPONSE_)[a-z0-9_]{1,52}$/iu.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  if (detail.kind === "resource") return "SIDECAR_RESOURCE";
  if (/^(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|fetch failed|Load failed)$/iu.test(message.trim())) return "NETWORK_UNREACHABLE";
  if (/授权 AI 连接|Authorize the AI connection/iu.test(message)) return "SIDECAR_AI_PERMISSION";
  if (capture) return "SIDECAR_CAPTURE_FAILED";
  return detail.name === "TypeError" ? "SIDECAR_RUNTIME_ERROR" : "SIDECAR_UPDATE_FAILED";
}
