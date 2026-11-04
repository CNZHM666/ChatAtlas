import { ArrowRight } from "lucide-react";
import type { FocusSection } from "../../shared/focus-session";
import { chapterSteps } from "../chapter-understanding";
import { evidencePresentation } from "../evidence-presentation";
import { reviewLead } from "../review-presentation";

/** Preview saved Wiki text, preferring the matching heading over another topic's introduction. */
export function ConceptWikiLinks({ sections, title, completedIds, zh, onRead }: { sections: FocusSection[]; title: string; completedIds: string[]; zh: boolean; onRead: (id: string) => void }) {
  const normalize = (value: string) => evidencePresentation(value).normalize("NFKC").replace(/[*_`]/gu, "").trim().toLowerCase();
  return <div className="project-concept-chapters"><h3>{zh ? "Wiki 章节" : "Wiki chapters"}</h3>{sections.length ? sections.map(section => {
    const steps = chapterSteps({ ...section, semanticStructure: undefined, understandingPath: undefined });
    const matching = steps.filter(step => normalize(step.title) === normalize(title));
    const summary = reviewLead(matching.length ? matching.map(step => step.body).join("\n\n") : section.body, 2);
    const chapterTitle = section.origin || section.userEdited ? section.title : evidencePresentation(section.title);
    const read = completedIds.includes(section.id);
    return <button className="concept-wiki-card" type="button" key={section.id} aria-label={`${chapterTitle} ${read ? zh ? "已阅读" : "Read" : zh ? "阅读章节 →" : "Read chapter →"}`} onClick={() => onRead(section.id)}>
      <span className="concept-wiki-content"><strong>{chapterTitle}</strong>{summary ? <span className="concept-wiki-summary">{summary}</span> : null}</span>
      <span className="concept-wiki-action">{read ? <small>{zh ? "已阅读" : "Read"}</small> : null}<ArrowRight size={17} aria-hidden="true" /></span>
    </button>;
  }) : <p>{zh ? "暂无关联章节" : "No linked chapters"}</p>}</div>;
}
