import type {FocusGenerationTask} from "../storage/focus-generation-tasks";
import type {FocusSession} from "./focus-session";

/** Only explicit identities prove completion. Shared titles, goals, sources or
 * a full progress bar cannot complete a different request. */
export function focusTaskResult(task:Pick<FocusGenerationTask,"runId"|"sessionId">,sessions:FocusSession[]):FocusSession|undefined {
 return sessions.find(session=>!session.id.startsWith("partial:")&&(
  Boolean(task.runId&&session.runId===task.runId)||Boolean(task.sessionId&&session.id===task.sessionId)
 ));
}
