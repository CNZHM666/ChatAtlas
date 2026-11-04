import { useState, type ReactNode } from "react";
import type { FocusSection, FocusEvidence, FocusSession } from "../../shared/focus-session";
import { chapterPathRefresh, chapterSteps } from "../chapter-understanding";
import { moveRouteCard, removePersonalRouteCard, saveRouteCard } from "../focus-route";
import { FocusUnderstandingPath } from "./FocusUnderstandingPath";
import { understandingEdgeLabel } from "../../shared/understanding-relations";
import { chapterProjectLinks } from "../chapter-project-links";
import { projectStateModel } from "../../shared/project-state";
import { chapterConceptSteps } from "../chapter-understanding";
import { understandingEdges } from "../understanding-model";
import { hasUsefulUnderstandingDiagram } from "../understanding-presentation";

export function FocusChapterPath({ section, zh, project = false, onSave, editing = false, onLocate, onSource, evidence = [], session, onProjectModule, onAddNote, headerActions }: { headerActions?:ReactNode; onAddNote?: () => void; editing?: boolean; section: FocusSection; session?: FocusSession; zh: boolean; project?: boolean; onSave: (steps: FocusSection[]) => Promise<void>; onLocate: (title: string, id: string, body: string) => void; onSource?: (id: string) => void; evidence?: FocusEvidence[]; onProjectModule?: (id: string) => void }) {
  const steps = chapterSteps(section, session);
  const [activeId, setActiveId] = useState("");
  const projectLinks = chapterProjectLinks(section, steps, session);
  const plan = session ? projectStateModel(session) : undefined;
  const locatedModules = plan && !plan.stale ? [...new Map(projectLinks.map(link => [link.moduleId, link.module])).values()] : [];
  const viewSteps = steps.map(step => {
    const module = projectLinks.find(link => link.stepId === step.id)?.module;
    return module ? { ...step, responsibility: step.responsibility || module.purpose, inputs: step.inputs ?? module.inputs, outputs: step.outputs ?? module.outputs, layer: step.layer ?? module.layer } : step;
  });
  const hasLocalDiagram = hasUsefulUnderstandingDiagram(chapterConceptSteps(viewSteps), understandingEdges(viewSteps));
  const refreshed = chapterPathRefresh(section);
  const [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState(false);
  const uncertain = section.semanticStructure?.relations.filter(edge => edge.status === "uncertain") ?? [];
  const read = (id: string) => { setActiveId(id); const step = steps.find(item => item.id === id); if (step && !step.origin && !step.userEdited) {
    const normalized = (value: string) => value.replace(/\s+/gu, " ").trim();
    if (step.semanticStructure && !normalized(section.body).includes(normalized(step.body)) && onSource && step.evidenceIds[0]) onSource(step.evidenceIds[0]);
    else onLocate(step.title, step.id, step.body);
  } };
  return <>
    {onProjectModule && locatedModules.length && !hasLocalDiagram ? <section className="chapter-product-context" aria-label={zh ? "在产品中的位置" : "Place in the product"}>
      <h2>{zh ? "在产品中的位置" : "Place in the product"}</h2>
      <ul>{locatedModules.map(module => {
        const adjacent = plan!.relations.filter(edge => edge.from === module.id || edge.to === module.id).filter(edge => plan!.modules.some(item => item.id === (edge.from === module.id ? edge.to : edge.from) && item.status !== "uncertain" && item.status !== "superseded") && module.status !== "uncertain");
        return <li key={module.id}><div className="chapter-context-module"><span>{module.layer}</span><button type="button" onClick={() => onProjectModule(module.id)}>{module.title} ↗</button></div>
          {adjacent.length ? <div className="chapter-context-connections">{adjacent.map(edge => <p key={JSON.stringify([edge.from, edge.to, edge.kind])}><button type="button" onClick={() => onProjectModule(edge.from)}>{plan!.modules.find(item => item.id === edge.from)!.title}</button><span>{edge.kind === "contains" ? "⊃" : "→"} {edge.label} {edge.kind === "contains" ? "" : "→"}</span><button type="button" onClick={() => onProjectModule(edge.to)}>{plan!.modules.find(item => item.id === edge.to)!.title}</button></p>)}</div> : <p className="chapter-context-io">{module.inputs.length ? `${zh ? "输入" : "Inputs"}：${module.inputs.join(" · ")}` : ""}{module.inputs.length && module.outputs.length ? " → " : ""}{module.outputs.length ? `${zh ? "输出" : "Outputs"}：${module.outputs.join(" · ")}` : ""}</p>}
        </li>;
      })}</ul>
    </section> : null}
    <FocusUnderstandingPath headerActions={headerActions} hidePersonalNotes={project} onAddNote={onAddNote} sections={viewSteps} activeId={activeId} zh={zh} chapter adaptive presentationBody={section.body} project={project} rootTitle={section.title} evidence={evidence} onLocate={onSource ? ref => onSource(ref.id) : undefined} onRead={read} onDelete={editing || !project ? async id => { await onSave(removePersonalRouteCard(steps, id)); setActiveId(""); } : undefined} onSave={editing || !project ? async draft => { await onSave(saveRouteCard(steps, draft)); setActiveId(draft.id); } : undefined} onMove={editing || !project ? (id, before) => onSave(moveRouteCard(steps, id, before)) : undefined} />

    {uncertain.length ? <details className="chapter-uncertain-relations"><summary>{zh ? "待确认关系" : "Uncertain relations"} · {uncertain.length}</summary><ul>{uncertain.map((edge, index) => <li key={index}>{section.semanticStructure?.nodes.find(node => node.key === edge.from)?.title} · {understandingEdgeLabel(edge.kind, zh)} · {section.semanticStructure?.nodes.find(node => node.key === edge.to)?.title}{onSource && edge.evidenceIds[0] ? <button type="button" onClick={() => onSource(edge.evidenceIds[0])}>{zh ? "回看依据" : "Read source"}</button> : null}</li>)}</ul></details> : null}
    {refreshed && (editing || !project) ? <div className="chapter-route-refresh"><span>{zh ? "正文要点有变化" : "Chapter points changed"}</span><button disabled={refreshing} onClick={() => { setRefreshing(true); setRefreshError(false); void onSave(refreshed).catch(() => setRefreshError(true)).finally(() => setRefreshing(false)); }}>{zh ? "更新要点" : "Refresh points"}</button>{refreshError ? <small role="alert">{zh ? "未能保存，请重试" : "Could not save. Retry."}</small> : null}</div> : null}
  </>;
}


