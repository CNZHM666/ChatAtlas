import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { FocusMode } from "../../shared/focus-session";
import { usePreferences } from "../preferences";
import { AIQuickSelect } from "./AIQuickSelect";
import { ArrowRight } from "lucide-react";

export const GoalComposer = memo(function GoalComposer({ onStart, disabled = false, compact = false, goalValue, modeValue, onGoalChange, onConfigureAI, submitLabel, footerStart, children, simple = false }: { onStart: (goal: string, mode: FocusMode) => void; disabled?: boolean; compact?: boolean; goalValue?: string; modeValue?: FocusMode; onGoalChange?: (goal: string) => void; onModeChange?: (mode: FocusMode) => void; onConfigureAI?: () => void; submitLabel?: string; footerStart?: ReactNode; children?: ReactNode; simple?: boolean }) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [localGoal, setLocalGoal] = useState("");
  const [switchingAI, setSwitchingAI] = useState(false);
  const [aiReady, setAIReady] = useState(false);
  const goal = goalValue ?? localGoal;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { if (simple && inputRef.current) { inputRef.current.style.height = "auto"; inputRef.current.style.height = `${Math.min(200, Math.max(104, inputRef.current.scrollHeight))}px`; } }, [goal, simple]);
  const mode = modeValue === "answer" ? "answer" : "work";
  const placeholder = zh ? "输入你想完成的任务，例如：梳理项目进展、提炼关键决策…" : "Describe your task, such as organizing project progress or key decisions…";
  return <form className={`goal-composer ${compact ? "is-compact" : ""} ${simple ? "is-simple" : ""}`} onSubmit={(event) => { event.preventDefault(); if (goal.trim() && !disabled && !switchingAI) { if (onConfigureAI && !aiReady) onConfigureAI(); else onStart(goal.trim(), mode); } }}>
    <label><span className="sr-only">{zh ? "今天的目标" : "Today's goal"}</span><textarea ref={inputRef} value={goal} maxLength={240} onChange={(event) => { if (onGoalChange) onGoalChange(event.target.value); else setLocalGoal(event.target.value); }} placeholder={placeholder} rows={simple ? 3 : 6} /></label>
    {children}
    <div className="goal-composer-footer">
      <div className="goal-composer-tools">{footerStart ? <div className="goal-composer-materials">{footerStart}</div> : null}{!simple ? <AIQuickSelect zh={zh} onConfigure={onConfigureAI} onBusy={setSwitchingAI} onReady={setAIReady} /> : null}</div>
      <div className="goal-composer-actions">{simple ? <AIQuickSelect zh={zh} onConfigure={onConfigureAI} onBusy={setSwitchingAI} onReady={setAIReady} /> : null}<button className="primary" disabled={disabled || !goal.trim() || switchingAI}>{submitLabel ?? (zh ? "选择材料 →" : "Choose materials →")}{simple ? <ArrowRight size={14} aria-hidden="true" /> : null}</button></div>
    </div>
  </form>;
});
