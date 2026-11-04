import {WikiChapterBody} from "./WikiChapterOverview";
import {WikiRevisionSummary} from "./WikiRevisionSummary";
import { useMemo, useState, type ReactNode } from "react";
import type { FocusSection, FocusSession } from "../../shared/focus-session";
import { updatePreview } from "../update-preview";
import { ChapterDiff } from "./ChapterDiff";
import { ReaderGuide } from "./ReaderGuide";
import { projectStateChanges } from "../../shared/project-state";
import {createPortal} from "react-dom";

/** What a chapter changed from, offered beside its title instead of above its text. */
/** What changed in a chapter: its earlier text (shown as a diff) and earlier name. */
export interface ChapterChange { previousBody?: string; renamedFrom?: string }
export function FocusUpdatePreview({ previous, next, zh, renderSection, pendingSectionId,summaryHost }: { previous: FocusSession; next: FocusSession; zh: boolean; renderSection?: (section: FocusSection, content: ReactNode, change: ChapterChange) => ReactNode; pendingSectionId?:string;summaryHost?:HTMLElement|null }) {
  const [all, setAll] = useState(false);
  const delta = useMemo(() => updatePreview(previous, next), [previous, next]);
  const sections = all ? next.sections : next.sections.filter(section => section.id === pendingSectionId || delta.changed.some(changed => changed.id === section.id));
  const project = projectStateChanges(previous, next);
  const added = next.sections.filter(section => !delta.previousBySection.has(section.id)).length;
  const titleOf = (section: FocusSection) => section.wikiDisplayTitle || section.title;
  const renamed = next.sections.flatMap(section => { const old = delta.previousBySection.get(section.id); return old && titleOf(old) !== titleOf(section) ? [{ from: titleOf(old), to: titleOf(section) }] : []; });
  // One sentence of what happened; zero counts say nothing and are left out.
  const whole = delta.changed.length === next.sections.length && next.sections.length > 0;
  // One short line: the result, then only the structural counts. "8 章（原 8 章）"
  // repeats itself, so the previous count appears only when it differs.
  const headline = whole ? next.sections.length === previous.sections.length ? zh ? `重新整理全部 ${next.sections.length} 章` : `All ${next.sections.length} chapters reorganized` : zh ? `${next.sections.length} 章（原 ${previous.sections.length} 章）` : `${next.sections.length} chapters (was ${previous.sections.length})` : zh ? `更新 ${delta.changed.length} 章` : `${delta.changed.length} chapters updated`;
  // Kept notes and personal cards are preserved by design; they are not news here.
  const counts = [
    [added, zh ? `新增 ${added}` : `${added} new`], [delta.removed.length, zh ? `合并 ${delta.removed.length}` : `${delta.removed.length} merged`], [renamed.length, zh ? `改名 ${renamed.length}` : `${renamed.length} renamed`],
  ].filter(([count]) => count).map(([, text]) => text as string);
  const summary=<div className="update-preview-summary" role="region" aria-label={zh?"本次整理":"Reorganization summary"}><div className="update-summary-main"><strong>{headline}</strong>{counts.length ? <span>{counts.join(" · ")}</span> : null}</div>{delta.unchanged ? <button type="button" className="update-summary-toggle" aria-pressed={all} onClick={() => setAll(!all)}>{all ? zh ? "只看变化" : "Changes only" : zh ? "查看全部" : "Show all"}</button> : null}
      {delta.removed.length || renamed.length ? <details className="update-chapter-changes"><summary>{zh ? "章节变化" : "Chapter changes"}</summary><ul>{delta.removed.map(section => <li key={section.id}>{section.title}{next.wikiSectionAliases?.[section.id] ? ` → ${next.sections.find(page=>page.id===next.wikiSectionAliases?.[section.id])?.title??next.wikiSectionAliases[section.id]}` : zh ? "（已移除）" : " (removed)"}</li>)}{renamed.map(item => <li key={`rename:${item.from}`}>{zh ? "改名：" : "Renamed: "}{item.from} → {item.to}</li>)}</ul></details> : null}
    </div>;
  return <section className="focus-update-preview" aria-label={zh ? "更新变化" : "Update changes"}>
    {next.wikiRevisionReceipt?.basisSessionId===previous.id?<WikiRevisionSummary receipt={next.wikiRevisionReceipt} evidence={next.evidence} zh={zh}/>:null}
    {project ? <div className="project-update-summary"><strong>{zh ? `模块：新增 ${project.added.length} · 调整 ${project.changed.length} · 替换 ${project.removed.length}` : `Modules: ${project.added.length} added · ${project.changed.length} changed · ${project.removed.length} superseded`}</strong><p>{zh ? `决策变化 ${project.decisions.length} 项${project.relationsChanged ? " · 模块关系有变化" : ""} · 约束变化 ${project.constraints.length} 项 · 问题变化 ${project.questions.length} 项` : `${project.decisions.length} decision changes${project.relationsChanged ? " · relationships changed" : ""} · ${project.constraints.length} constraint changes · ${project.questions.length} question changes`}</p>{project.added.length + project.changed.length + project.removed.length ? <ul>{project.added.map(item => <li key={`add:${item.id}`}>+ {item.title}</li>)}{project.changed.map(item => <li key={`change:${item.id}`}>↻ {item.title}</li>)}{project.removed.map(item => <li key={`remove:${item.id}`}>− {item.title}</li>)}</ul> : null}</div> : null}
    {summaryHost?createPortal(summary,summaryHost):summaryHost===undefined?summary:null}
    {next.wikiContentReview?.moves.length&&next.wikiContentReview!==previous.wikiContentReview?<details><summary>{zh?`内容归属调整 ${next.wikiContentReview.moves.length} 项`:`${next.wikiContentReview.moves.length} topic moves`}</summary><ul>{next.wikiContentReview.moves.map((move,index)=><li key={index}>{previous.sections.find(section=>section.id===move.fromId)?.title??move.fromId} / {move.topicTitle} → {next.sections.find(section=>section.id===move.toId)?.title??move.toId}</li>)}</ul></details>:null}
    {!sections.length ? <p>{zh ? "正文没有变化" : "No text changes"}</p> : null}
    {Object.entries(next.wikiSuggestions ?? {}).filter(([id, suggestion]) => previous.wikiSuggestions?.[id]?.body !== suggestion.body).map(([id, suggestion]) => <details className="update-old-text" key={`suggestion:${id}`}><summary>{suggestion.title} · {zh ? "更新建议，保留你的正文" : "Update suggestion; your text retained"}</summary><ReaderGuide content={suggestion.body} zh={zh} complete hideEvidenceMarkers /></details>)}
    <ol>{sections.map(section => {
      const old = delta.previousBySection.get(section.id);
      const change: ChapterChange = { ...(old && old.body !== section.body ? { previousBody: old.body } : {}), ...(old && titleOf(old) !== titleOf(section) ? { renamedFrom: titleOf(old) } : {}) };
      const content = <>{next.mode==="work"?<WikiChapterBody section={section} zh={zh} statusInHeading={Boolean(renderSection)}/>:<ReaderGuide content={section.body} zh={zh} complete hideEvidenceMarkers/>}</>;
      // Without a chapter header to hold them, the rename and old text stay inline.
      return <li key={section.id}>{renderSection ? renderSection(section, content, change) : <><h2>{section.title}</h2>{change.renamedFrom ? <p className="muted">{zh ? "原名：" : "Previously: "}{change.renamedFrom}</p> : null}{change.previousBody !== undefined ? <details className="update-old-text"><summary>{zh ? "和旧版对比" : "Compare with earlier"}</summary><ChapterDiff before={change.previousBody} after={section.body} zh={zh}/></details> : null}{content}</>}</li>;
    })}</ol>
  </section>;
}
