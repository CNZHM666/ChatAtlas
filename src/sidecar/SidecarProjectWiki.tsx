import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import type { FocusSession } from "../shared/focus-session";
import { localizedWikiTitle, wikiSections } from "../shared/wiki-navigation";
import { WIKI_OPEN_CHAPTER_EVENT } from "../shared/wiki-chapter-links";

const ChapterBody = lazy(async () => ({ default: (await import("../canvas/components/WikiChapterOverview")).WikiChapterBody }));

export function SidecarProjectWiki({ project, chapterId, onRead, zh, onOpen }: {
  project: FocusSession; chapterId?: string; onRead: (sectionId?: string) => void; zh: boolean; onOpen: (sectionId?: string) => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const chapterBody = useRef<HTMLElement>(null);
  const pages = useMemo(() => wikiSections(project, zh ? "zh-CN" : "en").filter(section => section.body.trim()), [project, zh]);
  const position = pages.findIndex(section => section.id === chapterId);
  const chapter = pages[position];
  const sourceTexts = useMemo(() => chapter && project.evidence.filter(ref => chapter.evidenceIds.includes(ref.id)).map(ref => ref.excerpt), [chapter, project.evidence]);
  const titleOf = (page: typeof pages[number]) => page.wikiDisplayTitle || localizedWikiTitle(page, zh);
  useLayoutEffect(() => {
    if (!chapterId || !chapterBody.current) return;
    chapterBody.current.scrollTop = 0;
    titleRef.current?.focus({ preventScroll: true });
  }, [chapterId]);
  useEffect(() => {
    const open = (event: Event) => {
      const target = (event as CustomEvent<string>).detail;
      const id = project.wikiSectionAliases?.[target] ?? target;
      if (pages.some(page => page.id === id)) onRead(id);
    };
    window.addEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
    return () => window.removeEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
  }, [pages, project.wikiSectionAliases, onRead]);
  if (!pages.length) return null;
  const workspace = zh ? "打开工作区" : "Open workspace";
  return <section className="sidecar-project-wiki" data-reading={Boolean(chapter) || undefined} aria-label={zh ? "项目 Wiki" : "Project Wiki"}>
    <header>
      {chapter ? <button type="button" className="sidecar-wiki-action" onClick={() => onRead()}><ArrowLeft size={14} aria-hidden="true"/>{zh ? "章节目录" : "Chapters"}</button>
        : <div><span><BookOpen size={14} aria-hidden="true"/>{zh ? "项目 Wiki" : "Project Wiki"}</span><h2>{project.title}</h2></div>}
      <button type="button" className="sidecar-wiki-action" onClick={() => onOpen(chapter?.id)}>{workspace}<ArrowUpRight size={14} aria-hidden="true"/></button>
    </header>
    {chapter ? <>
      <article ref={chapterBody} className="sidecar-reading-content sidecar-wiki-chapter" tabIndex={0} aria-label={titleOf(chapter)}>
        <h2 ref={titleRef} tabIndex={-1}>{titleOf(chapter)}</h2>
        <Suspense fallback={<p role="status">{zh ? "读取章节…" : "Loading chapter…"}</p>}>
          <ChapterBody key={chapter.id} section={chapter} sourceTexts={sourceTexts} zh={zh}/>
        </Suspense>
      </article>
      {pages.length > 1 && <nav className="sidecar-wiki-pager" aria-label={zh ? "相邻章节" : "Adjacent chapters"}>
        <button type="button" className="sidecar-wiki-action" disabled={position === 0} onClick={() => onRead(pages[position - 1]?.id)}><ChevronLeft size={14} aria-hidden="true"/>{zh ? "上一章" : "Previous"}</button>
        <button type="button" className="sidecar-wiki-action" disabled={position === pages.length - 1} onClick={() => onRead(pages[position + 1]?.id)}>{zh ? "下一章" : "Next"}<ChevronRight size={14} aria-hidden="true"/></button>
      </nav>}
    </> : <ul className="sidecar-wiki-chapters">
      {pages.map(page => <li key={page.id}><button type="button" onClick={() => onRead(page.id)}><span>{titleOf(page)}</span><ChevronRight size={14} aria-hidden="true"/></button></li>)}
    </ul>}
  </section>;
}
