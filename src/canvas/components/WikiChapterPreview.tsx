import { useId, useState, type ReactNode } from "react";
import type { FocusSection } from "../../shared/focus-session";
import { wikiDraftKept } from "../../shared/wiki-review";
import type { ChapterChange } from "./FocusUpdatePreview";
import { ChapterDiff } from "./ChapterDiff";

/** A chapter in the preview: its title, change classification badge, optional selective-acceptance toggle,
 * leaving it out, and its prose changes against the earlier version as a red/green diff. */
export function WikiChapterPreview({
  section,
  zh,
  busy,
  onExclude,
  children,
  feedback,
  candidate,
  number,
  change,
  selectable = false,
  selected = true,
  onToggleSelect,
}: {
  section: FocusSection;
  zh: boolean;
  busy: boolean;
  children: ReactNode;
  feedback?: ReactNode;
  candidate?: ReactNode;
  number?: number;
  change?: ChapterChange;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Sources are opened from the evidence markers in the text; kept for callers. */
  onSources?: () => void;
  /** Leave this chapter out of the project before saving; absent when it cannot be. */
  onExclude?: () => void;
  /** Earlier review controls, no longer shown in the preview. */
  instruction?: string;
  onInstruction?: (text: string) => void;
  onKeep?: () => void;
  onRewrite?: () => void;
}) {
  const [comparing, setComparing] = useState(false);
  const id = useId();
  const kept = wikiDraftKept(section);

  const badge =
    change?.changeKind === "added" || change?.kind === "added"
      ? { className: "is-added", label: zh ? "新增" : "Added", title: undefined }
      : change?.changeKind === "substantive"
        ? {
            className: "is-substantive",
            label: zh ? "实质更新" : "Substantive",
            title:
              (change.addedClaims ?? 0) + (change.removedClaims ?? 0) > 0
                ? zh
                  ? `新增 ${change.addedClaims ?? 0} 条 · 变更/移除 ${change.removedClaims ?? 0} 条要点`
                  : `+${change.addedClaims ?? 0} / -${change.removedClaims ?? 0} claim changes`
                : undefined,
          }
        : change?.changeKind === "polish"
          ? {
              className: "is-polish",
              label: zh ? "措辞微调" : "Wording polish",
              title: zh ? "核心事实与引用未变，仅调整表达或格式" : "Facts and citations unchanged; phrasing or formatting refined",
            }
          : change?.kind === "updated"
            ? { className: "is-updated", label: zh ? "已更新" : "Updated", title: undefined }
            : undefined;

  return (
    <section
      className={`wiki-chapter-preview${selectable && !selected ? " is-unselected-update" : ""}`}
      aria-labelledby={`${id}-title`}
    >
      <header className="wiki-chapter-preview-heading">
        <div className="wiki-chapter-preview-title">
          <div className="wiki-chapter-preview-title-row">
            <h2 id={`${id}-title`}>
              {number ? <span className="wiki-chapter-number" aria-hidden="true">{number}. </span> : null}
              {section.title}
            </h2>
            {badge ? (
              <span className={`wiki-chapter-change-badge ${badge.className}`} title={badge.title}>
                {badge.label}
              </span>
            ) : null}
          </div>
          {change?.renamedFrom ? <small>{zh ? "原名：" : "Previously: "}{change.renamedFrom}</small> : null}
        </div>
        <div className="wiki-chapter-preview-controls">
          {selectable && onToggleSelect ? (
            <label className={`wiki-chapter-adopt-toggle${selected ? " is-checked" : ""}`}>
              <input
                type="checkbox"
                checked={selected}
                disabled={busy}
                onChange={onToggleSelect}
              />
              <span>{selected ? (zh ? "采纳本章" : "Accept") : (zh ? "保留旧版" : "Keep old")}</span>
            </label>
          ) : null}
          {kept ? <small className="wiki-chapter-kept">{zh ? "已保留" : "Kept"}</small> : null}
          {change?.previousBody !== undefined ? (
            <button
              type="button"
              aria-expanded={comparing}
              aria-controls={`${id}-diff`}
              onClick={() => setComparing(!comparing)}
            >
              {comparing ? (zh ? "收起对比" : "Hide changes") : (zh ? "和旧版对比" : "Compare with earlier")}
            </button>
          ) : null}
          {onExclude ? (
            <button
              type="button"
              className="wiki-review-exclude"
              disabled={busy}
              title={zh ? "不纳入的章节不会写进项目，可随时重新纳入" : "Left-out chapters are not saved; you can include them again"}
              onClick={onExclude}
            >
              {zh ? "不纳入本项目" : "Leave out"}
            </button>
          ) : null}
        </div>
      </header>
      {comparing && change?.previousBody !== undefined ? (
        <div id={`${id}-diff`}>
          <ChapterDiff before={change.previousBody} after={section.body} zh={zh} />
        </div>
      ) : null}
      {feedback}
      {candidate}
      <div className="wiki-chapter-preview-content">{children}</div>
    </section>
  );
}
