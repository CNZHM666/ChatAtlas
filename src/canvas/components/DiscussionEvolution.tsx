import { discussionStageTags } from "../discussion-stage-tags";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { FocusEvidence } from "../../shared/focus-session";
import type { overviewModel } from "../overview-model";
import { ReaderGuide } from "./ReaderGuide";

type Orientation = ReturnType<typeof overviewModel>;
export function DiscussionEvolution({ orientation, zh, onRead, onLocate, heading, defaultCollapsed = false }: { defaultCollapsed?: boolean; orientation: Orientation; zh: boolean; heading?: string; onRead: (id: string) => void; onLocate: (evidence: FocusEvidence) => void }) {
  const [focused, setFocused] = useState(false), [selected, setSelected] = useState(orientation.stages[0]?.id);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const { stages, milestones } = orientation;
  const index = Math.max(0, stages.findIndex(stage => stage.id === selected)), active = stages[index];
  if (!stages.length) return null;
  const activeMilestones = milestones.filter(item => item.stageId === active.id);
  const hasStageSource = active.evidence && activeMilestones.some(item => item.evidence?.conversationId === active.evidence!.conversationId && item.evidence?.messageId === active.evidence!.messageId);
  const read = (stage: Orientation["stages"][number]) => { if (stage.evidence) onLocate(stage.evidence); else if (stage.sectionId) onRead(stage.sectionId); };
  const tags = (stage: Orientation["stages"][number]) => <span className="evolution-tags">{stage.sourceLabel ? <small>{stage.sourceLabel}</small> : null}{discussionStageTags(stage.title, stage.phase, zh).map(tag => <small key={tag}>{tag}</small>)}</span>;
  const badge = (id: string) => milestones.some(item => item.stageId === id && item.kind === "turn") ? <small className="evolution-turn">{zh ? "转折" : "Turning point"}</small> : milestones.some(item => item.stageId === id && item.kind === "confirmed") ? <small className="evolution-confirmed">{zh ? "已确认" : "Confirmed"}</small> : null;
  return <section className="discussion-evolution" aria-label={zh ? "讨论演进" : "Discussion evolution"}>
    <header className="discussion-evolution-heading"><h2>{heading ?? (zh ? "回顾原始讨论" : "Review original discussions")}</h2><div>{stages.length > 1 ? <button type="button" aria-pressed={focused} onClick={() => { setCollapsed(false); setFocused(!focused); }}>{focused ? zh ? "查看全程" : "Show all" : zh ? "逐步回顾" : "Step through"}</button> : null}<button type="button" aria-expanded={!collapsed} aria-label={collapsed ? zh ? "展开讨论依据" : "Expand discussion history" : zh ? "收起讨论依据" : "Collapse discussion history"} onClick={() => setCollapsed(!collapsed)}><ChevronDown size={16} /></button></div></header><div hidden={collapsed}>
    {focused ? <><div className="reader-step-controls"><button type="button" disabled={!index} onClick={() => setSelected(stages[index - 1].id)}>{zh ? "上一步" : "Previous"}</button><span aria-live="polite">{index + 1} / {stages.length}</span><button type="button" disabled={index === stages.length - 1} onClick={() => setSelected(stages[index + 1].id)}>{zh ? "下一步" : "Next"}</button></div><progress value={index + 1} max={stages.length} aria-label={zh ? "回顾进度" : "Review progress"} /></> : <ol className="overview-evolution">{stages.map((stage, position) => <li key={stage.id}><span>{position + 1}</span><div><button type="button" onClick={() => { setSelected(stage.id); setFocused(true); }}>{stage.title}</button><div className="evolution-stage-labels">{badge(stage.id)}{tags(stage)}</div></div></li>)}</ol>}
    {focused ? <section className="evolution-detail" key={active.id} aria-label={zh ? "阶段详情" : "Stage detail"}>
      <header><h3>{active.title}</h3>{tags(active)}</header>
      {active.body ? <ReaderGuide content={active.body} zh={zh} complete hideEvidenceMarkers /> : null}
      {activeMilestones.map((item, position) => <div className="evolution-milestone" key={position}><small>{item.kind === "turn" ? zh ? "转折" : "Turning point" : zh ? "已确认" : "Confirmed"}</small><p>{item.text}</p>{item.evidence ? <button type="button" onClick={() => onLocate(item.evidence!)}>{zh ? "回看讨论" : "Read discussion"}</button> : null}</div>)}
      {!hasStageSource ? <button type="button" disabled={!active.evidence && !active.sectionId} onClick={() => read(active)}>{zh ? orientation.chronological ? "回看这一段讨论" : "阅读这一节" : orientation.chronological ? "Read this discussion" : "Read this chapter"}</button> : null}
    </section> : null}
  </div></section>;
}
