import { useId, useState, type ReactNode } from "react";
import type { FocusSection } from "../../shared/focus-session";
import { wikiDraftKept } from "../../shared/wiki-review";
import type {ChapterChange} from "./FocusUpdatePreview";
import { ChapterDiff } from "./ChapterDiff";

/** A chapter in the preview: its title, leaving it out, and, after an update, its changes against the earlier
 * version as a red and green diff. Checking claims happens on the evidence markers in the text. */
export function WikiChapterPreview({ section, zh, busy, onExclude, children, feedback, candidate, number, change }: {
  section: FocusSection; zh: boolean; busy: boolean; children: ReactNode; feedback?: ReactNode; candidate?: ReactNode; number?:number; change?: ChapterChange;
  /** Sources are opened from the evidence markers in the text; kept for callers. */
  onSources?: () => void;
  /** Leave this chapter out of the project before saving; absent when it cannot be. */
  onExclude?: () => void;
  /** Earlier review controls, no longer shown in the preview. */
  instruction?: string; onInstruction?: (text: string) => void; onKeep?: () => void; onRewrite?: () => void;
}) {
  const [comparing, setComparing] = useState(false), id = useId();
  const kept = wikiDraftKept(section);
  return <section className="wiki-chapter-preview" aria-labelledby={`${id}-title`}>
    <header className="wiki-chapter-preview-heading"><div className="wiki-chapter-preview-title"><div className="wiki-chapter-preview-title-row"><h2 id={`${id}-title`}>{number?<span className="wiki-chapter-number" aria-hidden="true">{number}. </span>:null}{section.title}</h2></div>{change?.renamedFrom ? <small>{zh ? "原名：" : "Previously: "}{change.renamedFrom}</small> : null}</div><div>
      {kept ? <small className="wiki-chapter-kept">{zh ? "已保留" : "Kept"}</small> : null}
      {change?.previousBody !== undefined ? <button type="button" aria-expanded={comparing} aria-controls={`${id}-diff`} onClick={() => setComparing(!comparing)}>{comparing ? zh ? "收起对比" : "Hide changes" : zh ? "和旧版对比" : "Compare with earlier"}</button> : null}
      {onExclude ? <button type="button" className="wiki-review-exclude" disabled={busy} title={zh ? "不纳入的章节不会写进项目，可随时重新纳入" : "Left-out chapters are not saved; you can include them again"} onClick={onExclude}>{zh ? "不纳入本项目" : "Leave out"}</button> : null}
    </div></header>
    {comparing && change?.previousBody !== undefined ? <div id={`${id}-diff`}><ChapterDiff before={change.previousBody} after={section.body} zh={zh}/></div> : null}
    {feedback}{candidate}{children}
  </section>;
}
