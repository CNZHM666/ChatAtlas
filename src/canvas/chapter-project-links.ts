import type { FocusSection, FocusSession } from "../shared/focus-session";
import { projectStateModel } from "../shared/project-state";
import { evidencePresentation } from "./evidence-presentation";

/** A shared name alone cannot link a historical chapter to the current plan. */
export function chapterProjectLinks(section: FocusSection, steps: FocusSection[], session?: FocusSession) {
  const plan = session?.mode === "work" ? projectStateModel(session) : undefined;
  if (!plan || section.userEdited || section.origin === "user") return [];
  const normalize = (text: string) => evidencePresentation(text).normalize("NFKC").replace(/[*_`\s]/gu, "").toLowerCase();
  return steps.flatMap(step => {
    if (step.origin || step.userEdited) return [];
    const matches = plan.modules.filter(module => module.status !== "superseded" && normalize(module.title) === normalize(step.title)
      && module.evidenceIds.some(id => step.evidenceIds.includes(id))
      && module.quote.trim().length >= 4 && normalize(step.body).includes(normalize(module.quote)));
    return matches.length === 1 ? [{ stepId: step.id, moduleId: matches[0].id, title: matches[0].title, module: matches[0] }] : [];
  });
}
