import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronDown, ChevronLeft, ChevronRight, ListTree, Pencil, Plus, Quote, X } from "lucide-react";
import type { FocusEvidence, FocusSection, FocusSession } from "../shared/focus-session";
import { ProjectConversationNotes } from "../canvas/components/ProjectConversationNotes";
import { localizedWikiTitle, wikiSections } from "../shared/wiki-navigation";
import { WIKI_OPEN_CHAPTER_EVENT } from "../shared/wiki-chapter-links";
import { sidecarRecordStatus } from "../shared/project-continuation";
import { WIKI_EVIDENCE_LINK, wikiEvidenceTarget } from "../shared/wiki-evidence-link";
import { wikiQuoteRange } from "../shared/wiki-claims";
import { ReaderGuide } from "../canvas/components/ReaderGuide";

const ChapterBody = lazy(async () => ({ default: (await import("../canvas/components/WikiChapterOverview")).WikiChapterBody }));

interface ChapterSubheading {
  level: number;
  text: string;
}

function extractChapterSubheadings(body: string): ChapterSubheading[] {
  const headings: ChapterSubheading[] = [];
  let inFence = false;
  let fenceChar = "";
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const fence = /^(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (!inFence) { inFence = true; fenceChar = fence[1][0]; }
      else if (fence[1][0] === fenceChar) { inFence = false; fenceChar = ""; }
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,4})\s+(.+?)\s*#*$/u.exec(line);
    if (!match) continue;
    const text = match[2]
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/[*_`~]/gu, "")
      .replace(/\s*〔[^〕]+〕/gu, "")
      .trim();
    if (text) headings.push({ level: match[1].length, text });
  }
  return headings;
}

const normalizeHeadingKey = (text: string) => text.replace(/\s+/gu, " ").trim().toLowerCase();

export function SidecarProjectWiki({ project, chapterId, onRead, zh, onOpen, onEdit, onAdd, onSource, showProjectTitle = true, compact = false }: {
  project: FocusSession; chapterId?: string; onRead: (sectionId?: string) => void; zh: boolean; onOpen?: (sectionId?: string) => void; showProjectTitle?: boolean;
  compact?: boolean;
  onEdit?: (section: FocusSection) => void; onAdd?: () => void;
  onSource?: (ref: FocusEvidence, quote?: string) => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const chapterBody = useRef<HTMLElement>(null);
  const citationTrigger = useRef<HTMLElement | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [sourceControls, setSourceControls] = useState<HTMLDivElement | null>(null);
  const [sourceNavigation, setSourceNavigation] = useState<HTMLDivElement | null>(null);
  const sourceControlsId = useId();
  const tocId = useId();
  const [selected, setSelected] = useState<{ chapterId: string; ref: FocusEvidence; key?: string; quote?: string; approximate?: boolean }>();
  const pages = useMemo(() => wikiSections(project, zh ? "zh-CN" : "en").filter(section => onEdit || section.body.trim()), [project, zh, onEdit]);
  const position = pages.findIndex(section => section.id === chapterId);
  const chapter = pages[position];
  const subheadings = useMemo(() => chapter ? extractChapterSubheadings(chapter.body) : [], [chapter]);
  const sources = useMemo(() => {
    if (!chapter) return [];
    const ids = new Set([...chapter.evidenceIds, ...(chapter.claims ?? []).flatMap(claim => claim.evidenceIds)]);
    return project.evidence.filter(ref => ids.has(ref.id));
  }, [chapter, project.evidence]);
  const sourceTexts = useMemo(() => sources.map(ref => ref.excerpt), [sources]);
  const source = showSources && onSource && selected?.chapterId === chapter?.id ? selected : undefined;
  const openCitation = (ref: FocusEvidence, key?: string, quote?: string, approximate?: boolean, navigate = false) => {
    if (!chapter) return;
    if (!navigate && source?.key === key && source?.ref.id === ref.id) { closeCitation(); return; }
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement && !sourceNavigation?.contains(trigger)) citationTrigger.current = trigger;
    setSelected({ chapterId: chapter.id, ref, key, quote, approximate });
  };
  const closeCitation = () => {
    setSelected(undefined);
    citationTrigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const body = chapterBody.current;
    if (!source?.key || !body) return;
    const marker = [...body.querySelectorAll<HTMLElement>("[data-claim-key]")].find(node => node.dataset.claimKey === source.key);
    if (!marker) return;
    const bounds = body.getBoundingClientRect(), position = marker.getBoundingClientRect();
    if (position.top < bounds.top || position.bottom > bounds.bottom) {
      body.scrollTop += position.top - bounds.top - body.clientHeight / 3;
    }
  }, [source]);
  const excerpt = source?.ref.excerpt.trim() ?? "";
  const quoteRange = source?.quote && wikiQuoteRange(excerpt, source.quote);
  const quote = quoteRange ? excerpt.slice(quoteRange.start, quoteRange.end) : excerpt;
  const titleOf = (page: typeof pages[number]) => page.wikiDisplayTitle || localizedWikiTitle(page, zh);
  const scrollToSubheading = (targetText: string, occurrence: number) => {
    const body = chapterBody.current;
    setTocOpen(false);
    if (!body) return;
    const wanted = normalizeHeadingKey(targetText);
    const matches = [...body.querySelectorAll<HTMLElement>(".reader-guide-prose h2, .reader-guide-prose h3, .reader-guide-prose h4")]
      .filter(node => normalizeHeadingKey(node.textContent ?? "").includes(wanted));
    const node = matches[occurrence] ?? matches[0];
    if (!node) return;
    const top = body.scrollTop + node.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
    body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };
  useLayoutEffect(() => {
    setTocOpen(false);
    if (!chapterId || !chapterBody.current) return;
    chapterBody.current.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true });
  }, [chapterId]);
  useEffect(() => {
    const open = (event: Event) => {
      const target = (event as CustomEvent<string>).detail;
      const id = project.wikiSectionAliases?.[target] ?? target;
      if (pages.some(page => page.id === id)) { setSelected(undefined); onRead(id); }
    };
    window.addEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
    return () => window.removeEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
  }, [pages, project.wikiSectionAliases, onRead]);
  if (!pages.length) return null;
  const notes = pages.filter(page => page.continuationLoose);
  const chapters = pages.filter(page => !page.continuationLoose);
  const readingNote = Boolean(compact && chapter?.continuationLoose);
  const adjacent = compact ? readingNote ? notes : chapters : pages;
  const adjacentPosition = chapter ? adjacent.indexOf(chapter) : -1;
  const prevChapter = adjacentPosition > 0 ? adjacent[adjacentPosition - 1] : undefined;
  const nextChapter = adjacentPosition >= 0 && adjacentPosition < adjacent.length - 1 ? adjacent[adjacentPosition + 1] : undefined;
  const status = chapter && readingNote ? sidecarRecordStatus(chapter, zh) : undefined;
  const notesLabel = zh ? "项目记录" : "Project notes";
  const readChapter = (id?: string) => { setSelected(undefined); setTocOpen(false); onRead(id); };
  const noteList = <ProjectConversationNotes notes={notes} evidence={project.evidence} zh={zh} onRead={readChapter}
    onSource={onSource ? ref => onSource(ref) : undefined} compact={compact}/>;
  const workspace = zh ? "打开工作区" : "Open workspace";
  const seenHeadingCounts = new Map<string, number>();
  return <section className="sidecar-project-wiki" data-reading={Boolean(chapter) || undefined} data-compact={compact || undefined} data-note={readingNote || undefined} aria-label={zh ? "项目 Wiki" : "Project Wiki"} onKeyDown={event => {
    if (event.key === "Escape" && tocOpen) { event.stopPropagation(); setTocOpen(false); return; }
    if (event.key === "Escape" && source) { event.stopPropagation(); closeCitation(); }
  }}>
    <header>
      {chapter ? <button type="button" className="sidecar-wiki-action sidecar-wiki-back" onClick={() => readChapter()}><ArrowLeft size={14} aria-hidden="true"/>{notes.length ? zh ? "返回文档" : "Back to document" : zh ? "章节目录" : "Chapters"}</button>
        : showProjectTitle
          ? <div><span><BookOpen size={14} aria-hidden="true"/>{zh ? "项目 Wiki" : "Project Wiki"}</span><h2>{project.title}</h2></div>
          : <h2>{chapters.length ? zh ? "章节目录" : "Chapters" : notesLabel}</h2>}
      <div className="sidecar-wiki-tools">
        {chapter && onSource && sources.length > 0 && <button type="button" className="sidecar-wiki-action" aria-pressed={showSources} aria-expanded={showSources} aria-controls={sourceControlsId}
          onClick={() => { setSelected(undefined); setShowSources(value => !value); }}><Quote size={14} aria-hidden="true"/>{showSources ? zh ? "隐藏出处" : "Hide sources" : zh ? "显示出处" : "Show sources"}</button>}
        {chapter && onEdit && <button type="button" className="sidecar-wiki-action" onClick={() => onEdit(chapter)}><Pencil size={14} aria-hidden="true"/>{zh ? "编辑" : "Edit"}</button>}
        {!chapter && onAdd && <button type="button" className="sidecar-wiki-action" onClick={onAdd}><Plus size={14} aria-hidden="true"/>{zh ? "新建章节" : "New chapter"}</button>}
        {onOpen && <button type="button" className="sidecar-wiki-action" onClick={() => onOpen(chapter?.id)} aria-label={workspace} title={workspace}>
          {(!chapter || !onEdit) && !onAdd && workspace}<ArrowUpRight size={15} aria-hidden="true"/>
        </button>}
      </div>
    </header>
    {chapter ? <>
      {onSource && sources.length > 0 && <div id={sourceControlsId} ref={setSourceControls} className="sidecar-source-controls" hidden={!showSources}/>}
      {subheadings.length >= 2 && <div className="sidecar-chapter-toc" data-open={tocOpen || undefined}>
        <button type="button" className="sidecar-chapter-toc-toggle" aria-expanded={tocOpen} aria-controls={tocId} onClick={() => setTocOpen(value => !value)}>
          <ListTree size={13} aria-hidden="true"/>
          <span>{zh ? `本节大纲 · ${subheadings.length}` : `In this chapter · ${subheadings.length}`}</span>
          <ChevronDown size={14} aria-hidden="true"/>
        </button>
        {tocOpen && <ol id={tocId} className="sidecar-chapter-toc-list">
          {subheadings.map((item, idx) => {
            const key = normalizeHeadingKey(item.text);
            const occurrence = seenHeadingCounts.get(key) ?? 0;
            seenHeadingCounts.set(key, occurrence + 1);
            return <li key={`${idx}-${item.text}`} data-level={item.level}>
              <button type="button" onClick={() => scrollToSubheading(item.text, occurrence)}>{item.text}</button>
            </li>;
          })}
        </ol>}
      </div>}
      <article ref={chapterBody} className="sidecar-reading-content sidecar-wiki-chapter" data-show-sources={showSources && !!onSource || undefined} tabIndex={0} aria-label={titleOf(chapter)} onClick={event => {
        const link = (event.target as Element).closest(`a[href^="${WIKI_EVIDENCE_LINK}"]`);
        if (!link) return;
        event.preventDefault();
        const target = wikiEvidenceTarget(link.getAttribute("href") ?? "");
        const ref = project.evidence.find(item => item.id === target?.id);
        if (ref && showSources && onSource) openCitation(ref);
      }}>
        <h2 ref={titleRef} tabIndex={-1}>{titleOf(chapter)}</h2>
        {status && <small className="sidecar-record-status">{status}</small>}
        <Suspense fallback={<p role="status">{zh ? "读取章节…" : "Loading chapter…"}</p>}>
          <ChapterBody key={chapter.id} section={chapter} sourceTexts={sourceTexts} zh={zh} hideProposalStatus hideVersionCards
            sourceMarks={showSources && onSource ? sources : undefined} activeSourceKey={source?.key}
            sourceControls={sourceControls} sourceNavigation={sourceNavigation} activeOriginalId={source?.ref.id} sourceBody={chapterBody}
            onOriginal={ref => openCitation(ref, undefined, undefined, undefined, true)}
            onSelectSource={(point, navigate) => openCitation(point.reference, point.key, point.quote, point.approximate, navigate)}/>
        </Suspense>
        {readingNote && adjacent.length > 1 && <nav className="sidecar-wiki-pager" aria-label={zh ? "相邻记录" : "Adjacent notes"}>
          <button type="button" className="sidecar-wiki-action" disabled={adjacentPosition === 0} onClick={() => readChapter(adjacent[adjacentPosition - 1]?.id)}><ChevronLeft size={14} aria-hidden="true"/>{zh ? "上一条" : "Previous note"}</button>
          <span className="sidecar-wiki-pager-count" aria-live="polite">{adjacentPosition + 1} / {adjacent.length}</span>
          <button type="button" className="sidecar-wiki-action" disabled={adjacentPosition === adjacent.length - 1} onClick={() => readChapter(adjacent[adjacentPosition + 1]?.id)}>{zh ? "下一条" : "Next note"}<ChevronRight size={14} aria-hidden="true"/></button>
        </nav>}
      </article>
      {source && onSource && <aside className="sidecar-citation-preview" aria-label={zh ? "出处预览" : "Source preview"}>
        <header>
          <div className="sidecar-citation-title"><small>{source.approximate ? (zh ? "相近出处" : "Possible source") : (zh ? "原话摘录" : "Original excerpt")}</small>
            <h3 title={source.ref.title}>{source.ref.title || (zh ? "当前引用" : "Current citation")}</h3></div>
          <div ref={setSourceNavigation} className="sidecar-citation-navigation"/>
          <button type="button" className="sidecar-wiki-action" aria-label={zh ? "关闭出处" : "Close source"} onClick={closeCitation}><X size={16} aria-hidden="true"/></button>
        </header>
        {quote && <div key={`${source.key ?? ""}:${source.ref.id}`} className="sidecar-citation-quote sidecar-reading-content" tabIndex={0}
          role="region" aria-label={zh ? "引用原文" : "Cited passage"}><ReaderGuide content={quote} zh={zh} complete hideCitationAnnotations/></div>}
        <button type="button" className="sidecar-wiki-action sidecar-citation-context" onClick={() => onSource(source.ref, quote)}>{zh ? "查看上下文" : "View context"}<ChevronRight size={14} aria-hidden="true"/></button>
      </aside>}
      {!readingNote && adjacent.length > 1 && <nav className="sidecar-wiki-pager" aria-label={zh ? "相邻章节" : "Adjacent chapters"}>
        <button type="button" className="sidecar-wiki-action" disabled={!prevChapter}
          aria-label={zh ? "上一章" : "Previous"} title={prevChapter ? titleOf(prevChapter) : undefined}
          onClick={() => prevChapter && readChapter(prevChapter.id)}><ChevronLeft size={14} aria-hidden="true"/>{zh ? "上一章" : "Previous"}</button>
        <span className="sidecar-wiki-pager-count" aria-live="polite">{adjacentPosition + 1} / {adjacent.length}</span>
        <button type="button" className="sidecar-wiki-action" disabled={!nextChapter}
          aria-label={zh ? "下一章" : "Next"} title={nextChapter ? titleOf(nextChapter) : undefined}
          onClick={() => nextChapter && readChapter(nextChapter.id)}>{zh ? "下一章" : "Next"}<ChevronRight size={14} aria-hidden="true"/></button>
      </nav>}
    </> : <>
      {chapters.length > 0 && <ul className="sidecar-wiki-chapters">
        {chapters.map(page => <li key={page.id}><button type="button" title={compact ? titleOf(page) : undefined} onClick={() => readChapter(page.id)}><span>{titleOf(page)}</span><ChevronRight size={14} aria-hidden="true"/></button></li>)}
      </ul>}
      {compact && chapters.length > 0 && notes.length > 0 ? <details className="sidecar-wiki-notes">
        <summary><span>{notesLabel}</span><small>{notes.length}</small><ChevronRight size={14} aria-hidden="true"/></summary>
        {noteList}
      </details> : noteList}
    </>}
  </section>;
}
