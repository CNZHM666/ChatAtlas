import { ArrowRight, ChevronDown, GitCompareArrows } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { FocusSection, FocusSession } from "../../shared/focus-session";
import { extractComparisonProse } from "../../shared/diff-prose";
import { sentenceDiff, type DiffPart } from "../../shared/text-diff";
import { updatePreview } from "../update-preview";
import { WorkbenchDialog } from "./WorkbenchDialog";

const titleOf = (section?: FocusSection) => section?.wikiDisplayTitle || section?.title;
type ComparisonChapter = { key: string; before?: FocusSection; after?: FocusSection; mergedInto?: string; kind: "changed" | "added" | "removed" | "same" };

function renderInlineMarkdown(text: string): ReactNode {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/u).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index} className="comparison-inline-code">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function ChapterComparison({ chapter, zh, beforeLabel, afterLabel }: { chapter: ComparisonChapter; zh: boolean; beforeLabel: string; afterLabel: string }) {
  const [expanded, setExpanded] = useState<number[]>([]);
  const contextId = useId();
  const { parts, onlyNonProseChanged } = useMemo(() => {
    const rawBefore = chapter.before?.body ?? "";
    const rawAfter = chapter.after?.body ?? "";
    const before = extractComparisonProse(rawBefore);
    const after = extractComparisonProse(rawAfter);
    const diff = sentenceDiff(before, after);
    const hasProseDiff = diff.some((part) => part.kind !== "same");
    return {
      parts: diff as DiffPart[],
      onlyNonProseChanged: !hasProseDiff && rawBefore !== rawAfter,
    };
  }, [chapter]);

  const groups: { same: string[]; removed: string[]; added: string[] }[] = [];
  for (const part of parts) {
    let group = groups.at(-1);
    if (!group || Boolean(group.same.length) !== (part.kind === "same")) {
      group = { same: [], removed: [], added: [] };
      groups.push(group);
    }
    group[part.kind].push(part.text);
  }
  const added = parts.filter((part) => part.kind === "added").length;
  const removed = parts.filter((part) => part.kind === "removed").length;
  const oldTitle = titleOf(chapter.before);
  const newTitle = titleOf(chapter.after);

  const renderLine = (text: string, index: number, kind: "added" | "removed" | "same") => {
    const heading = /^(#{1,6})\s+(.+)/u.exec(text);
    const bullet = /^[-*+]\s+(.+)/u.exec(text);
    const body = heading ? heading[2] : bullet ? `• ${bullet[1]}` : text;
    return (
      <p key={index} className={heading ? "comparison-diff-heading" : bullet ? "comparison-diff-bullet" : undefined}>
        <span className="comparison-diff-sign" aria-hidden="true">{kind === "added" ? "+" : kind === "removed" ? "−" : ""}</span>
        <span>{renderInlineMarkdown(body)}</span>
      </p>
    );
  };

  return (
    <>
      <div className="comparison-chapter-heading">
        <div>
          <h3>{newTitle ?? oldTitle}</h3>
          {oldTitle && newTitle && oldTitle !== newTitle && (
            <p>{zh ? "原章节名" : "Previous title"} · {oldTitle}</p>
          )}
        </div>
        {chapter.mergedInto && <p>{zh ? "已并入" : "Merged into"} · {chapter.mergedInto}</p>}
        {(removed > 0 || added > 0) && (
          <div className="comparison-line-counts">
            {removed > 0 && <span data-kind="removed">−{removed} {zh ? "删除" : "removed"}</span>}
            {added > 0 && <span data-kind="added">+{added} {zh ? "新增" : "added"}</span>}
          </div>
        )}
      </div>

      {parts.length === 0 || (!removed && !added) ? (
        <p className="comparison-empty">
          {!chapter.before || !chapter.after
            ? (zh ? "此章节没有正文。" : "This chapter has no prose.")
            : onlyNonProseChanged
              ? (zh ? "两版正文相同（仅参考示例、代码块或引用标记有调整）。" : "Prose is unchanged (only reference examples, code blocks, or citation metadata changed).")
              : (zh ? "两版正文相同。" : "The chapter prose is the same in both versions.")}
        </p>
      ) : (
        <div className="comparison-diff">
          <div className="comparison-diff-labels">
            <strong>{beforeLabel}</strong>
            <strong>{afterLabel}</strong>
          </div>
          {groups.map((group, index) => {
            if (!group.same.length) {
              return (
                <div className="comparison-diff-row" key={index}>
                  <div className="comparison-diff-cell" data-kind={group.removed.length ? "removed" : undefined}>
                    <small>{beforeLabel}</small>
                    {group.removed.length ? group.removed.map((text, at) => renderLine(text, at, "removed")) : <span className="comparison-diff-empty">—</span>}
                  </div>
                  <div className="comparison-diff-cell" data-kind={group.added.length ? "added" : undefined}>
                    <small>{afterLabel}</small>
                    {group.added.length ? group.added.map((text, at) => renderLine(text, at, "added")) : <span className="comparison-diff-empty">—</span>}
                  </div>
                </div>
              );
            }
            const foldable = group.same.length > 2;
            const open = expanded.includes(index);
            const id = `${contextId}-${index}`;
            return (
              <div className="comparison-diff-context" key={index}>
                {foldable && (
                  <button
                    type="button"
                    className="comparison-context-toggle"
                    aria-expanded={open}
                    aria-controls={id}
                    onClick={() => setExpanded((current) => (current.includes(index) ? current.filter((value) => value !== index) : [...current, index]))}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                    {open
                      ? (zh ? "收起共同正文" : "Hide unchanged passages")
                      : (zh ? `展开 ${group.same.length} 段共同正文` : `Show ${group.same.length} unchanged passages`)}
                  </button>
                )}
                <div id={id} hidden={foldable && !open} className="comparison-context-lines">
                  {(!foldable || open) && group.same.map((text, at) => (
                    <div className="comparison-diff-row comparison-context-row" key={at}>
                      <div className="comparison-diff-cell">{renderLine(text, at, "same")}</div>
                      <div className="comparison-diff-cell" aria-hidden="true">{renderLine(text, at, "same")}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export function ProjectVersionComparison({ previous, current, zh, onClose, preview = false }: { previous: FocusSession; current: FocusSession; zh: boolean; onClose: () => void; preview?: boolean }) {
  const beforeLabel = preview ? (zh ? "已保存" : "Saved") : (zh ? "上一版" : "Previous");
  const afterLabel = preview ? (zh ? "整理预览" : "Proposed") : (zh ? "当前版" : "Current");
  const chapters = useMemo(() => {
    const delta = updatePreview(previous, current);
    const changed = new Set(delta.changed.map((section) => section.id));
    return [
      ...current.sections.map<ComparisonChapter>((after) => {
        const before = delta.previousBySection.get(after.id);
        const proseChanged = before ? extractComparisonProse(before.body) !== extractComparisonProse(after.body) : true;
        const renamed = before ? titleOf(before) !== titleOf(after) : false;
        const isChanged = !before || renamed || (changed.has(after.id) && proseChanged);
        return { key: `current:${after.id}`, before, after, kind: !before ? "added" : isChanged ? "changed" : "same" };
      }),
      ...delta.removed.map<ComparisonChapter>((before) => {
        const merged = current.sections.find((section) => section.id === current.wikiSectionAliases?.[before.id]);
        return { key: `previous:${before.id}`, before, mergedInto: titleOf(merged), kind: "removed" };
      }),
    ];
  }, [previous, current]);

  const labels = { changed: zh ? "修改" : "Edited", added: zh ? "新增" : "Added", removed: zh ? "移除" : "Removed", same: zh ? "未改动" : "Unchanged" };
  const changed = chapters.filter((chapter) => chapter.kind !== "same");
  const [selected, setSelected] = useState(changed[0]?.key);
  const active = changed.find((chapter) => chapter.key === selected) ?? changed[0];
  const stamp = (session: FocusSession) => new Date(session.createdAt).toLocaleString(zh ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const title = preview ? (zh ? "对比当前文档" : "Compare with saved document") : (zh ? "和上一版对比" : "Compare with previous version");

  return (
    <WorkbenchDialog className="version-comparison-dialog" title={title} description={current.title} closeLabel={zh ? "关闭对比" : "Close comparison"} onClose={onClose}>
      <div className="comparison-version-bar">
        <div><strong>{beforeLabel}</strong><span>{stamp(previous)}</span></div>
        <ArrowRight size={15} aria-hidden="true" />
        <div><strong>{afterLabel}</strong><span>{stamp(current)}</span></div>
        <span className="comparison-prose-badge">{zh ? "仅展示正文变化" : "Prose only"}</span>
        <span className="comparison-summary">
          {zh ? `${changed.length} 章有变化 · ${chapters.length - changed.length} 章未改动` : `${changed.length} changed · ${chapters.length - changed.length} unchanged`}
        </span>
      </div>
      {active ? (
        <div className="comparison-split">
          <nav className="comparison-navigation" aria-label={zh ? "变更章节" : "Changed chapters"}>
            {changed.map((chapter) => (
              <button
                type="button"
                key={chapter.key}
                aria-current={chapter.key === active.key ? "true" : undefined}
                onClick={() => setSelected(chapter.key)}
              >
                <span title={titleOf(chapter.after ?? chapter.before)}>{titleOf(chapter.after ?? chapter.before)}</span>
                <small data-kind={chapter.mergedInto ? undefined : chapter.kind}>
                  {chapter.mergedInto ? (zh ? "合并" : "Merged") : labels[chapter.kind]}
                </small>
              </button>
            ))}
          </nav>
          <div className="comparison-main" key={active.key} tabIndex={0} role="region" aria-label={zh ? "章节差异" : "Chapter differences"}>
            <ChapterComparison chapter={active} zh={zh} beforeLabel={beforeLabel} afterLabel={afterLabel} />
          </div>
        </div>
      ) : (
        <div className="comparison-no-changes">
          <GitCompareArrows size={22} aria-hidden="true" />
          <p>{zh ? "两版正文没有变化。" : "There are no prose changes between these versions."}</p>
        </div>
      )}
    </WorkbenchDialog>
  );
}
