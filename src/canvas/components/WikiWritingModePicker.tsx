import { useEffect, useId, useRef, useState } from "react";
import { Check, FileCheck2, FileCode2, FolderArchive } from "lucide-react";
import type { WikiWritingMode } from "../../shared/wiki-knowledge";
import { WIKI_WRITING_MODES } from "../../shared/wiki-writing-modes";
import "../decision-steps.css";

const MODES = [
  {
    id: "concise",
    icon: FileCheck2,
    tag: ["推荐 · 快速阅读", "Recommended · Quick read"],
    description: ["项目主线、关键决定与待决事项。", "Project direction, key decisions, and open questions."],
  },
  {
    id: "handoff",
    icon: FileCode2,
    tag: ["研发 / Agent 交接", "Dev / Agent handoff"],
    description: ["给开发者和 Coding Agent 的约束、字段、流程与验收条件。", "Constraints, fields, workflows, and acceptance criteria for developers and coding agents."],
  },
  {
    id: "audit",
    icon: FolderArchive,
    tag: ["完整追溯", "Full trail"],
    description: ["保留提案、历史方案、确认记录与核验说明。", "Proposals, earlier versions, confirmation records, and verification notes."],
  },
] as const;

export function WikiWritingModePicker({ current, zh, onChoose, onCancel }: {
  current?: WikiWritingMode;
  zh: boolean;
  onChoose: (mode: WikiWritingMode) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<WikiWritingMode>(current ?? "concise");
  const modal = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = modal.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  const form = <form className="decision-steps wiki-writing-mode" aria-labelledby={id} onSubmit={event => {
    event.preventDefault();
    if (!onCancel || current !== mode) onChoose(mode);
  }}>
    <h3 id={id}>{zh ? "写作模式" : "Writing mode"}</h3>
    {onCancel ? <p className="decision-steps-ask">{zh ? "复用已提取的知识点和确认记录，先预览新稿。" : "Reuse the extracted knowledge and decisions, then preview the new draft."}</p> : null}
    <WikiWritingModeOptions mode={mode} zh={zh} onChange={setMode}/>
    <footer>
      {onCancel ? <button type="button" onClick={onCancel}>{zh ? "取消" : "Cancel"}</button> : null}
      <button className="primary" type="submit" disabled={Boolean(onCancel && current === mode)}>
        {onCancel ? zh ? "生成预览" : "Generate preview" : zh ? "开始写作" : "Start writing"}
      </button>
    </footer>
  </form>;
  return onCancel ? <dialog className="wiki-writing-mode-dialog" ref={modal} aria-labelledby={id}
    onCancel={event => { event.preventDefault(); onCancel(); }}>{form}</dialog> : form;
}

export function WikiWritingModeOptions({ mode, zh, onChange }: {
  mode: WikiWritingMode;
  zh: boolean;
  onChange: (mode: WikiWritingMode) => void;
}) {
  const id = useId();
  const lang = zh ? 0 : 1;
  return <fieldset className="wiki-writing-mode-grid" aria-label={zh ? "写作模式" : "Writing mode"}>
      {MODES.map(({ id: value, icon: Icon, tag, description }) => <label key={value} className={mode === value ? "is-selected" : undefined}>
        <input type="radio" className="sr-only" name={id} value={value} checked={mode === value} onChange={() => onChange(value)}/>
        <div className="wiki-writing-mode-card-head">
          <span className="wiki-writing-mode-icon" aria-hidden="true"><Icon size={17} /></span>
          <span className="wiki-writing-mode-check" aria-hidden="true">{mode === value ? <Check size={12} /> : null}</span>
        </div>
        <span className="wiki-writing-mode-copy">
          <strong>{WIKI_WRITING_MODES[value][zh ? "zh" : "en"]}</strong>
          <em className="wiki-writing-mode-tag">{tag[lang]}</em>
          <small>{description[lang]}</small>
        </span>
      </label>)}
    </fieldset>;
}
