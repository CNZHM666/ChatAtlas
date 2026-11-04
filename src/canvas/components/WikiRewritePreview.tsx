import type { FocusSection } from "../../shared/focus-session";
import { WikiChapterBody } from "./WikiChapterOverview";
import {wikiTitleReviewIncomplete} from "../../shared/wiki-title-review";
import {WikiRevisionSummary} from "./WikiRevisionSummary";

export function WikiRewritePreview({ previous, next, zh, busy, onApply, onDiscard }: {
  previous: FocusSection; next: FocusSection; zh: boolean; busy: boolean; onApply: () => void; onDiscard: () => void;
}) {
  return <section className="wiki-rewrite-preview" aria-label={zh ? "本章整理预览" : "Chapter rewrite preview"}>
    <h2>{zh ? "本章整理预览" : "Chapter rewrite preview"} · {previous.title}</h2>
    <small>{zh ? "仅替换本章，保留其他章节；采用整理不代表确认事实。" : "Only this chapter changes. Applying text does not confirm facts."}</small>
    <WikiRevisionSummary receipt={next.wikiRevisionReceipt} zh={zh}/>
    {wikiTitleReviewIncomplete(next.wikiTitleReview)?<p role="status">{zh?"标题未整理完成，已保留原名和正文。":"Title editing could not finish. The original name and prose are preserved."}</p>:null}
    <div className="wiki-rewrite-comparison">{[{label:zh?"原稿":"Original",section:previous},{label:zh?"新稿":"Candidate",section:next}].map(({label,section})=><div key={label}><h3>{label} · {section.title}</h3><WikiChapterBody section={section} zh={zh}/></div>)}</div>
    <div className="wiki-review-actions"><button type="button" disabled={busy} onClick={onDiscard}>{zh ? "保留原稿" : "Keep original"}</button><button type="button" className="primary" disabled={busy} onClick={onApply}>{zh ? "采用这次整理" : "Apply rewrite"}</button></div>
  </section>;
}
