import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Github, Moon, Search, Sun } from "lucide-react";
import { WikiDocument } from "../canvas/components/WikiDocument";
import { WorkspaceSourcePanel } from "../canvas/components/WorkspaceSourcePanel";
import { ProjectExampleContext } from "../canvas/project-example-context";
import { WorkspaceEvidenceContext, type WorkspaceEvidenceOptions } from "../canvas/workspace-evidence-context";
import { brandLogos } from "../shared/brand-assets";
import type { FocusEvidence } from "../shared/focus-session";
import { architectureChapter, demoProject, type DemoLocale } from "./project";

const repository = "https://github.com/CNZHM666/ChatAtlas";
const release = repository + "/releases";
const words = {
  zh: { demo: "只读演示", back: "项目总览", search: "搜索示例对话", fictional: "虚构项目", install: "安装扩展", theme: "切换主题",
    reviewHint: "点「核对依据」可从 Claude 追溯到 Gemini，也可以直接查看下方表格的来源。", sources: "对话来源", chapters: "Wiki 章节",
    find: "搜索", empty: "没有匹配的示例消息。", searchPrompt: "试试搜索「回滚」或「引脚」。", export: "导出 Markdown",
    exportLabel: "导出选项", excerpts: "附上原话", copy: "复制", copied: "已复制 Markdown", download: "下载", downloaded: "已下载 Markdown",
    failed: "操作失败。可以重试，或改用下载。", close: "关闭", extension: "导入自己的对话", user: "用户", assistant: "AI 回复" },
  en: { demo: "Read-only demo", back: "Project overview", search: "Search sample chats", fictional: "Fictional project", install: "Install extension", theme: "Switch theme",
    reviewHint: "Use Check evidence to trace decisions from Claude to Gemini, or open the table’s source directly.", sources: "Source conversations", chapters: "Wiki chapters",
    find: "Search", empty: "No matching sample messages.", searchPrompt: "Try searching for “rollback” or “pin”.", export: "Export Markdown",
    exportLabel: "Export options", excerpts: "Include original quotes", copy: "Copy", copied: "Markdown copied", download: "Download", downloaded: "Markdown downloaded",
    failed: "That didn't work. Try again or use Download.", close: "Close", extension: "Import your own chats", user: "User", assistant: "AI reply" },
} as const;
type DemoWords = (typeof words)[DemoLocale];

function readPreference(key: string) {
  try { return window.localStorage.getItem("chatatlas-demo-" + key); } catch { return null; }
}
function savePreference(key: string, value: string) {
  try { window.localStorage.setItem("chatatlas-demo-" + key, value); } catch { /* React state retains this visit's choice. */ }
}
function initialLocale(): DemoLocale {
  const requested = new URLSearchParams(location.search).get("lang");
  if (requested === "zh" || requested === "en") return requested;
  const preferred = readPreference("lang");
  return preferred === "zh" || preferred === "en" ? preferred : navigator.language.startsWith("zh") ? "zh" : "en";
}

export function DemoApp() {
  const [locale, setLocale] = useState(initialLocale);
  const [theme, setTheme] = useState<keyof typeof brandLogos>(() => readPreference("theme") === "dark" ? "dark" : "light");
  const [route, setRoute] = useState(() => location.hash.slice(1));
  const [source, setSource] = useState<{ reference: FocusEvidence; options: WorkspaceEvidenceOptions }>();
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const readingBody = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const t = words[locale], zh = locale === "zh";
  const { knowledge, platforms } = useMemo(() => demoProject(locale), [locale]);
  const session = knowledge.session;
  const readers = useMemo(() => ({
    message: (reference: FocusEvidence) => knowledge.messages.find(message => message.id === reference.messageId && message.conversationId === reference.conversationId),
    knowledge: () => knowledge,
  }), [knowledge]);
  const chapter = session.sections.find(section => route === "/wiki/" + section.id) ?? session.sections[0];
  const onSearch = route === "/search", onOverview = route === "/overview";
  const isWiki = !onSearch && !onOverview;
  const open = (reference: FocusEvidence, options: WorkspaceEvidenceOptions = {}) => setSource({ reference, options });
  const close = () => setSource(undefined);
  const review = () => {
    const passages = (chapter.claims ?? []).flatMap(claim => claim.evidenceIds.map(referenceId => ({ referenceId, quote: claim.quote ?? "" })));
    const references = chapter.evidenceIds.flatMap(id => session.evidence.find(ref => ref.id === id) ?? []);
    if (references[0]) open(references[0], { references, sourcePassages: passages, sectionId: chapter.id, mode: "view" });
  };
  useEffect(() => {
    const onHash = () => { setRoute(location.hash.slice(1)); setSource(undefined); setExportOpen(false); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
    document.title = "ChatAtlas · " + t.demo;
  }, [zh, t.demo]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const changeLanguage = () => {
    const next = zh ? "en" : "zh", url = new URL(location.href);
    url.searchParams.set("lang", next);
    history.replaceState(history.state, "", url);
    savePreference("lang", next);
    setLocale(next); close(); setQuery(""); setSubmitted("");
  };
  const normalizedQuery = submitted.toLocaleLowerCase();
  const matches = submitted ? knowledge.messages.filter(message => message.content.toLocaleLowerCase().includes(normalizedQuery)) : [];
  const followMatch = (messageId: string) => {
    const reference = session.evidence.find(ref => ref.messageId === messageId);
    if (!reference) return;
    const start = reference.excerpt.toLocaleLowerCase().indexOf(normalizedQuery);
    open(reference, { quote: reference.excerpt.slice(start, start + submitted.length), mode: "view" });
  };

  return <ProjectExampleContext.Provider value={readers}>
    <WorkspaceEvidenceContext.Provider value={{ open, close, active: source ? { ...source.options, shown: source.reference } : undefined }}>
      <div className={source ? "static-demo focus-workspace has-original-panel" : "static-demo focus-workspace"}>
        <div className="demo-base project-reading-base">
          <header className="demo-header">
            <a href="#/wiki/operation-plans" className="demo-brand"><img src={brandLogos[theme]} alt="" />ChatAtlas</a>
            <span className="demo-badge">{t.demo}</span>
            <div className="demo-actions">
              <button type="button" onClick={changeLanguage} lang={zh ? "en" : "zh-CN"}>{zh ? "English" : "简体中文"}</button>
              <button type="button" aria-label={t.theme} title={t.theme} onClick={() => {
                const next = theme === "light" ? "dark" : "light";
                setTheme(next); savePreference("theme", next);
              }}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
              <a href={repository}><Github size={16} aria-hidden="true" />GitHub</a><a className="demo-install" href={release}>{t.install}</a>
            </div>
          </header>
          <div className="demo-layout">
            <nav className="demo-nav" aria-label={t.chapters}>
              <div className="demo-project-name"><strong>Circuit Studio</strong><small>{t.fictional}</small></div>
              <a href="#/overview" aria-current={onOverview ? "page" : undefined}>{t.back}</a>
              {session.sections.map(section => <a key={section.id} href={"#/wiki/" + section.id} aria-current={!onSearch && !onOverview && chapter.id === section.id ? "page" : undefined}>{section.title}</a>)}
              <a href="#/search" aria-current={onSearch ? "page" : undefined}><Search size={16} />{t.search}</a>
            </nav>
            <main className="demo-main" key={route} ref={readingBody}>
              {onSearch ? <section className="demo-search">
                <h1>{t.search}</h1>
                <form onSubmit={event => { event.preventDefault(); setSubmitted(query.trim()); }}>
                  <input type="search" aria-label={t.search} value={query} onChange={event => setQuery(event.target.value)} /><button>{t.find}</button>
                </form>
                {!submitted ? <p>{t.searchPrompt}</p> : !matches.length ? <p role="status">{t.empty}</p> : <ul className="demo-results">
                  {matches.map(message => {
                    const index = message.content.toLocaleLowerCase().indexOf(normalizedQuery);
                    const conversation = knowledge.conversations.find(chat => chat.id === message.conversationId);
                    return <li key={message.id}><button type="button" onClick={() => followMatch(message.id)}>
                      <strong>{platforms.get(message.conversationId)} · {conversation?.title}</strong>
                      <small>{message.role === "user" ? t.user : t.assistant}</small>
                      <span>{message.content.slice(0, index)}<mark>{message.content.slice(index, index + submitted.length)}</mark>{message.content.slice(index + submitted.length)}</span>
                    </button></li>;
                  })}
                </ul>}
              </section> : onOverview ? <section className="demo-overview">
                <h1>Circuit Studio</h1><p>{session.brief?.summary}</p>
                <h2>{t.sources}</h2>
                <ul className="demo-results">{knowledge.conversations.map(chat => <li key={chat.id}><button type="button" onClick={() => {
                  const references = session.evidence.filter(ref => ref.conversationId === chat.id);
                  if (references[0]) open(references[0], { references });
                }}>{platforms.get(chat.id)} · {chat.title}</button></li>)}</ul>
                <a href={release}>{t.extension}</a>
              </section> : <>
                <div className="demo-reader-actions">
                  <button type="button" onClick={() => setExportOpen(!exportOpen)} aria-expanded={exportOpen}><Download size={16} />{t.export}</button>
                </div>
                {chapter.id === architectureChapter && <p className="demo-review-hint">{t.reviewHint}</p>}
                {exportOpen && <DemoExport session={session} chapterId={chapter.id} zh={zh} t={t} onClose={() => setExportOpen(false)} />}
                <WikiDocument key={locale + chapter.id} section={chapter} session={session} zh={zh} structure={null}
                  onLocate={open} onReviewEvidence={review} onCurrent={() => { location.hash = "/overview"; }} persistSourceMarks={false}
                  toolsHost={source ? toolsHost : null} scrollRef={readingBody} />
              </>}
            </main>
          </div>
        </div>
        {source && <WorkspaceSourcePanel key={locale} session={session} reference={source.reference} references={source.options.references} showSourceTitle
          sectionId={source.options.sectionId} quote={source.options.quote} sourcePassages={source.options.sourcePassages}
          claim={source.options.claim} tableTarget={source.options.tableTarget} zh={zh} mode="view" onClose={close}
          onToolsHost={isWiki ? setToolsHost : undefined} points={source.options.points} pointIndex={source.options.pointIndex}
          onPoint={index => {
            const point = source.options.points?.[index];
            if (point) open(point.reference, { ...source.options, claim: point.claim, quote: point.quote, references: point.references, pointIndex: index });
          }}
          locationRevision={source.options.locationRevision} onSelect={reference => open(reference, source.options.sourcePassages ? source.options : {
            ...source.options, claim: undefined, quote: undefined,
          })} />}
      </div>
    </WorkspaceEvidenceContext.Provider>
  </ProjectExampleContext.Provider>;
}

function DemoExport({ session, chapterId, zh, t, onClose }: {
  session: ReturnType<typeof demoProject>["knowledge"]["session"]; chapterId: string; zh: boolean; t: DemoWords; onClose: () => void;
}) {
  const [chapters, setChapters] = useState([chapterId]);
  const [excerpts, setExcerpts] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const write = async (copy: boolean) => {
    setBusy(true); setStatus("");
    try {
      const { projectDocument } = await import("../export/project-document");
      const file = projectDocument(session, { overview: false, wikiIds: chapters, matters: false, history: false, sources: excerpts,
        sourceMode: excerpts ? "excerpts" : "locators" }, "md", zh);
      if (copy) {
        await navigator.clipboard.writeText(file.text);
        setStatus(t.copied);
      } else {
        const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
        const link = document.createElement("a");
        link.href = url; link.download = file.filename; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus(t.downloaded);
      }
    } catch { setStatus(t.failed); }
    finally { setBusy(false); }
  };
  return <section className="demo-export" aria-label={t.exportLabel}>
    <div className="demo-export-fields">{session.sections.map(section => <label key={section.id}><input type="checkbox" checked={chapters.includes(section.id)}
      onChange={event => setChapters(event.target.checked ? [...chapters, section.id] : chapters.filter(id => id !== section.id))} />{section.title}</label>)}</div>
    <label><input type="checkbox" checked={excerpts} onChange={event => setExcerpts(event.target.checked)} />{t.excerpts}</label>
    <div className="demo-export-actions"><button type="button" disabled={busy || !chapters.length} onClick={() => void write(false)}>{t.download}</button>
      <button type="button" disabled={busy || !chapters.length} onClick={() => void write(true)}>{t.copy}</button><button type="button" onClick={onClose}>{t.close}</button></div>
    {status && <p role="status">{status}</p>}
  </section>;
}
