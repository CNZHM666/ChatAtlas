import { GitCompareArrows, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import type { FocusSection } from "../../shared/focus-session";
import { wikiTitleReviewIncomplete } from "../../shared/wiki-title-review";
import { ChapterDiff } from "./ChapterDiff";
import { WikiChapterBody } from "./WikiChapterOverview";
import { WikiRevisionSummary } from "./WikiRevisionSummary";

export function WikiRewritePreview({ previous, next, zh, busy, onApply, onDiscard, onRetry }: {
  previous: FocusSection; next: FocusSection; zh: boolean; busy: boolean; onApply: () => void; onDiscard: () => void; onRetry?: () => void;
}) {
  const [view, setView] = useState<"compare" | "diff">("compare");
  return (
    <section className="wiki-rewrite-preview" aria-label={zh ? "本章整理预览" : "Chapter rewrite preview"}>
      <header className="wiki-rewrite-preview-head">
        <div>
          <h2><Sparkles size={16} aria-hidden="true" />{zh ? "本章整理预览" : "Chapter rewrite preview"} · {previous.title}</h2>
          <small>{zh ? "仅替换本章，保留其他章节；采用整理不代表确认事实。" : "Only this chapter changes. Applying text does not confirm facts."}</small>
        </div>
        <div className="wiki-rewrite-view-tabs" role="tablist" aria-label={zh ? "预览方式" : "Preview mode"}>
          <button type="button" role="tab" aria-selected={view === "compare"} onClick={() => setView("compare")}>
            {zh ? "成稿对比" : "Side-by-side"}
          </button>
          <button type="button" role="tab" aria-selected={view === "diff"} onClick={() => setView("diff")}>
            <GitCompareArrows size={13} aria-hidden="true" />
            {zh ? "差异高亮" : "Prose diff"}
          </button>
        </div>
      </header>
      <WikiRevisionSummary receipt={next.wikiRevisionReceipt} zh={zh} />
      {wikiTitleReviewIncomplete(next.wikiTitleReview) ? (
        <p className="wiki-rewrite-notice" role="status">
          {zh ? "标题未整理完成，已保留原名和正文。" : "Title editing could not finish. The original name and prose are preserved."}
        </p>
      ) : null}
      {view === "diff" ? (
        <div className="wiki-rewrite-diff-pane">
          <ChapterDiff before={previous.body} after={next.body} zh={zh} />
        </div>
      ) : (
        <div className="wiki-rewrite-comparison">
          {[
            { label: zh ? "原稿" : "Original", section: previous, kind: "before" },
            { label: zh ? "新稿" : "Candidate", section: next, kind: "after" },
          ].map(({ label, section, kind }) => (
            <div key={label} className={`is-${kind}`}>
              <h3>{label} · {section.title}</h3>
              <WikiChapterBody section={section} zh={zh} />
            </div>
          ))}
        </div>
      )}
      <div className="wiki-review-actions">
        {onRetry ? (
          <button type="button" className="wiki-rewrite-retry" disabled={busy} onClick={onRetry}>
            <RotateCcw size={14} aria-hidden="true" />
            {zh ? "换个要求再试" : "Try another prompt"}
          </button>
        ) : null}
        <button type="button" disabled={busy} onClick={onDiscard}>{zh ? "保留原稿" : "Keep original"}</button>
        <button type="button" className="primary" disabled={busy} onClick={onApply}>{zh ? "采用这次整理" : "Apply rewrite"}</button>
      </div>
    </section>
  );
}
