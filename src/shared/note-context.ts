import type { FocusSession } from "./focus-session";
import { projectStateModel } from "./project-state";

/** Keep a readable association even if a later project version omits the module. */
export function noteModuleTitle(session: FocusSession, note: { module?: { id: string; title: string } }): string {
  return note.module ? projectStateModel(session)?.modules.find(module => module.id === note.module!.id)?.title || note.module.title : "";
}

export function noteSectionTitle(session: FocusSession, note: { section?: { id: string; title: string } }): string {
  return note.section ? session.sections.find(section => section.id === note.section!.id)?.title || note.section.title : "";
}
