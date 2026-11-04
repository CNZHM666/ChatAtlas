import type { FocusSession } from "../shared/focus-session";
import { groupFocusVersions } from "../canvas/focus-versions";

/** Completed local results only; never use an unconfirmed revision as the handoff. */
export function savedSidecarProjects(sessions: FocusSession[]): FocusSession[] {
  return groupFocusVersions(sessions).flatMap(group => {
    const saved = group.versions.find(item => item.mode === "work" && item.status !== "preview" && (item.sections.length || item.projectState));
    return saved ? [saved] : [];
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}
