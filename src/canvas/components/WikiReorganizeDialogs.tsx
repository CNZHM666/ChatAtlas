import { AlertCircle, BookMarked, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { WorkbenchDialog } from "./WorkbenchDialog";

const CHAPTER_PRESETS = [
  {
    zhLabel: "更精炼紧凑",
    enLabel: "More concise",
    zhPrompt: "精简冗余表述，突出核心结论与关键约束条件，不遗漏重要事实。",
    enPrompt: "Tighten redundant phrasing and highlight key conclusions and constraints without dropping important facts.",
  },
  {
    zhLabel: "补全细节与条件",
    enLabel: "Fill in details",
    zhPrompt: "对照原始讨论补全遗漏的技术参数、前提条件、边界情况与具体说明。",
    enPrompt: "Restore missing technical parameters, preconditions, edge cases, and concrete details from the bound discussions.",
  },
  {
    zhLabel: "理顺结构与层级",
    enLabel: "Clarify structure",
    zhPrompt: "重新梳理小节划分与逻辑顺序，使阅读层次更清晰、前后衔接更顺畅。",
    enPrompt: "Reorganize subsection hierarchy and logical flow so the chapter reads cleanly from start to finish.",
  },
  {
    zhLabel: "按步骤拆解",
    enLabel: "Step-by-step",
    zhPrompt: "按执行步骤或决策推进顺序重组正文，便于快速复盘和落地执行。",
    enPrompt: "Structure the prose as clear actionable steps or decision progression for fast review.",
  },
];

export function ChapterRewriteDialog({
  chapterTitle,
  initialPrompt = "",
  isUserEdited = false,
  zh,
  busy,
  onClose,
  onSubmit,
}: {
  chapterTitle: string;
  initialPrompt?: string;
  isUserEdited?: boolean;
  zh: boolean;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (instruction: string) => void;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const submit = () => {
    if (busy) return;
    onSubmit(prompt.trim());
  };
  return (
    <WorkbenchDialog
      className="reorganize-action-dialog"
      title={zh ? "重整本章" : "Reorganize this chapter"}
      description={chapterTitle}
      closeLabel={zh ? "关闭" : "Close"}
      onClose={onClose}
    >
      <div className="reorganize-dialog-body">
        <p className="reorganize-dialog-hint">
          {zh
            ? "仅改写当前章节并在原位生成对比预览，不会影响其他章节；采用前原稿完全保留。"
            : "Rewrites only this chapter with an in-place preview. Other chapters stay untouched and your original is kept until applied."}
        </p>
        {isUserEdited ? (
          <div className="reorganize-user-edited-note" role="status">
            <ShieldCheck size={15} aria-hidden="true" />
            <span>
              {zh
                ? "本章含你的个人修改：将结合现有表述与绑定原文生成改写建议，不会自动覆盖手稿。"
                : "This chapter has personal edits: AI will generate a non-destructive rewrite suggestion using your current text and bound originals."}
            </span>
          </div>
        ) : null}
        <div className="reorganize-presets" role="group" aria-label={zh ? "常用改写方向" : "Quick rewrite presets"}>
          {CHAPTER_PRESETS.map((preset) => {
            const text = zh ? preset.zhPrompt : preset.enPrompt;
            const active = prompt.trim() === text;
            return (
              <button
                key={preset.enLabel}
                type="button"
                className={`reorganize-preset-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => setPrompt(active ? "" : text)}
              >
                <Sparkles size={12} aria-hidden="true" />
                <span>{zh ? preset.zhLabel : preset.enLabel}</span>
              </button>
            );
          })}
        </div>
        <label className="reorganize-prompt-field">
          <span>{zh ? "具体改写要求（可选）" : "Specific rewrite request (optional)"}</span>
          <textarea
            rows={3}
            maxLength={500}
            value={prompt}
            placeholder={zh ? "例如：保留参数对比，去掉重复背景说明，结论放在开头…" : "e.g. Keep parameter comparisons, trim background, lead with conclusions…"}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
        </label>
      </div>
      <footer className="reorganize-dialog-footer">
        <button type="button" className="reorganize-btn-secondary" onClick={onClose}>
          {zh ? "取消" : "Cancel"}
        </button>
        <button type="button" className="reorganize-btn-primary" disabled={busy} onClick={submit}>
          <RefreshCw size={14} aria-hidden="true" />
          <span>{zh ? "生成改写预览" : "Generate rewrite preview"}</span>
        </button>
      </footer>
    </WorkbenchDialog>
  );
}

export function ProjectReorganizeDialog({
  projectTitle,
  aiChapterCount,
  manualChapterCount,
  hasSourceChanges,
  sourcesSyncing,
  canSyncWithReorganize = true,
  zh,
  busy,
  onClose,
  onUpdateSources,
  onConfirm,
}: {
  projectTitle: string;
  aiChapterCount: number;
  manualChapterCount: number;
  hasSourceChanges: boolean;
  sourcesSyncing: boolean;
  canSyncWithReorganize?: boolean;
  zh: boolean;
  busy?: boolean;
  onClose: () => void;
  onUpdateSources: () => void;
  onConfirm: (options: { syncChangedSources: boolean; instruction: string }) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const showBlocker = sourcesSyncing || (hasSourceChanges && !canSyncWithReorganize);
  const showCombinedSync = hasSourceChanges && !sourcesSyncing && canSyncWithReorganize;

  return (
    <WorkbenchDialog
      className="reorganize-action-dialog"
      title={zh ? "重整全部章节" : "Reorganize all chapters"}
      description={projectTitle}
      closeLabel={zh ? "关闭" : "Close"}
      onClose={onClose}
    >
      <div className="reorganize-dialog-body">
        <p className="reorganize-dialog-hint">
          {zh
            ? "基于已保存的知识点账本重新规划目录结构并改写 AI 正文。生成完成后支持按章勾选采纳或与旧版逐句对比。"
            : "Replans the directory and rewrites AI-authored chapters from your saved ledger. You can selectively accept chapters and compare diffs before saving."}
        </p>
        <div className="reorganize-impact-pills">
          <span><BookMarked size={13} aria-hidden="true" />{zh ? `将重整 ${aiChapterCount} 个 AI 章节` : `${aiChapterCount} AI chapters to reorganize`}</span>
          {manualChapterCount > 0 ? (
            <span className="is-safe">{zh ? `完整保留 ${manualChapterCount} 个手动编辑章节` : `${manualChapterCount} manually edited preserved`}</span>
          ) : null}
        </div>
        {showCombinedSync ? (
          <div className="reorganize-user-edited-note" role="status">
            <RefreshCw size={15} aria-hidden="true" />
            <span>
              {zh
                ? "检测到来源对话有新变化：本次将先自动同步最新讨论，再统一重整目录与正文。"
                : "Source changes detected: this run will automatically sync new discussions first, then reorganize the full document."}
            </span>
          </div>
        ) : null}
        {showBlocker ? (
          <div className="reorganize-source-blocker" role="status">
            <AlertCircle size={15} aria-hidden="true" />
            <div>
              <strong>{sourcesSyncing ? (zh ? "来源对话正在同步中" : "Source conversations are still syncing") : (zh ? "检测到来源对话有新变化" : "Source conversations have new changes")}</strong>
              <p>{sourcesSyncing ? (zh ? "请等待同步完成后再执行全量重整。" : "Wait for syncing to finish before reorganizing all chapters.") : (zh ? "请先将新讨论增量更新进项目，再统一重整全部章节。" : "Update changed sources first so the reorganized document includes the latest discussion.")}</p>
            </div>
          </div>
        ) : null}
        <label className="reorganize-prompt-field">
          <span>{zh ? "本次重整侧重点（可选）" : "Reorganization focus (optional)"}</span>
          <textarea
            rows={2}
            maxLength={400}
            value={instruction}
            placeholder={zh ? "例如：合并重复章节、把架构设计拆成独立章、突出落地步骤…" : "e.g. Merge overlapping chapters, separate architecture, emphasize rollout steps…"}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      </div>
      <footer className="reorganize-dialog-footer">
        <button type="button" className="reorganize-btn-secondary" onClick={onClose}>
          {zh ? "取消" : "Cancel"}
        </button>
        {hasSourceChanges && !sourcesSyncing && !canSyncWithReorganize ? (
          <button type="button" className="reorganize-btn-primary" disabled={busy} onClick={onUpdateSources}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>{zh ? "先更新已变化的材料" : "Update changed sources first"}</span>
          </button>
        ) : (
          <button
            type="button"
            className="reorganize-btn-primary"
            disabled={busy || sourcesSyncing}
            onClick={() => onConfirm({ syncChangedSources: showCombinedSync, instruction: instruction.trim() })}
          >
            {showCombinedSync ? <RefreshCw size={14} aria-hidden="true" /> : <BookMarked size={14} aria-hidden="true" />}
            <span>{showCombinedSync ? (zh ? "同步新材料并重整" : "Sync sources & reorganize") : (zh ? "开始重整并预览" : "Start reorganizing")}</span>
          </button>
        )}
      </footer>
    </WorkbenchDialog>
  );
}
