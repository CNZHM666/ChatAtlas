import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Download, Github, Languages, LayoutDashboard, Moon, Sun } from "lucide-react";
import { DocumentOverview } from "../canvas/components/DocumentOverview";
import { ProjectSourceList } from "../canvas/components/ProjectSourceList";
import { ProjectWikiNavigation } from "../canvas/components/ProjectWikiNavigation";
import { ReaderBackButton } from "../canvas/components/ReaderBackButton";
import { ReaderConversation } from "../canvas/components/ReaderConversation";
import { WikiDocument } from "../canvas/components/WikiDocument";
import { WorkspaceSourcePanel } from "../canvas/components/WorkspaceSourcePanel";
import { ProjectExampleContext } from "../canvas/project-example-context";
import { WorkspaceEvidenceContext, type WorkspaceEvidenceOptions } from "../canvas/workspace-evidence-context";
import { BrandMark } from "../shared/BrandMark";
import type { FocusEvidence } from "../shared/focus-session";
import { architectureChapter, demoProject, type DemoLocale } from "./project";

const ProjectExportDialog = lazy(() => import("../canvas/components/ProjectExportDialog").then(module => ({ default: module.ProjectExportDialog })));
const repository = "https://github.com/CNZHM666/ChatAtlas";

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
  const [theme, setTheme] = useState<"light" | "dark">(() => readPreference("theme") === "dark" ? "dark" : "light");
  const [route, setRoute] = useState(() => location.hash.slice(1));
  const [source, setSource] = useState<{ reference: FocusEvidence; options: WorkspaceEvidenceOptions }>();
  const [fullSource, setFullSource] = useState(false);
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [navigationTab, setNavigationTab] = useState<"wiki" | "sources">("wiki");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [headingTarget, setHeadingTarget] = useState<{ title: string; revision: number }>();
  const readingBody = useRef<HTMLElement>(null);
  const readingBase = useRef<HTMLDivElement>(null);
  const zh = locale === "zh", tr = (cn: string, en: string) => zh ? cn : en;
  const { knowledge, overview } = useMemo(() => demoProject(locale), [locale]);
  const session = knowledge.session;
  const readers = useMemo(() => ({
    message: (reference: FocusEvidence) => knowledge.messages.find(message => message.id === reference.messageId && message.conversationId === reference.conversationId),
    knowledge: () => knowledge,
  }), [knowledge]);
  const chapter = session.sections.find(section => route === "/wiki/" + section.id) ?? session.sections.find(section => section.id === architectureChapter)!;
  const isOverview = route === "/overview";
  const original = fullSource && source ? knowledge.conversations.find(chat => chat.id === source.reference.conversationId) : undefined;
  const open = (reference: FocusEvidence, options: WorkspaceEvidenceOptions = {}) => {
    setNavigationOpen(false);
    setFullSource(Boolean(options.reader));
    setSource({ reference, options });
  };
  const close = () => { setFullSource(false); setSource(undefined); };
  const navigate = (next: string, heading?: string) => {
    close();
    setNavigationOpen(false);
    setHeadingTarget(heading ? { title: heading, revision: performance.now() } : undefined);
    if (!heading) readingBody.current?.scrollTo({ top: 0 });
    setRoute(next);
    if (location.hash.slice(1) !== next) location.hash = next;
  };
  const read = (id: string, heading?: string) => { setNavigationTab("wiki"); navigate("/wiki/" + id, heading); };
  const readOverview = () => navigate("/overview");
  const review = () => {
    const sourcePassages = (chapter.claims ?? []).flatMap(claim => claim.evidenceIds.map(referenceId => ({ referenceId, quote: claim.quote })));
    const references = chapter.evidenceIds.flatMap(id => session.evidence.find(ref => ref.id === id) ?? []);
    if (references[0]) open(references[0], { references, sourcePassages, sectionId: chapter.id, mode: "view" });
  };
  useEffect(() => {
    const onHash = () => {
      const next = location.hash.slice(1);
      // In-app chapter navigation sets its scroll target before the hash event.
      setRoute(next);
      setSource(undefined);
      setFullSource(false);
      setExportOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
    document.title = zh ? "ChatAtlas · 只读演示" : "ChatAtlas · Read-only demo";
  }, [zh]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const base = readingBase.current;
    if (!original || !base) return;
    base.inert = true;
    return () => { base.inert = false; };
  }, [original]);
  const changeLanguage = () => {
    const next = zh ? "en" : "zh", url = new URL(location.href);
    url.searchParams.set("lang", next);
    history.replaceState(history.state, "", url);
    savePreference("lang", next);
    setLocale(next);
    close();
  };

  return <div className="app-shell demo-shell">
    <header className="topbar">
      <button type="button" className="brand brand-home" onClick={readOverview} aria-label={tr("ChatAtlas 演示首页", "ChatAtlas demo home")}><BrandMark className="brand-mark" /><span>ChatAtlas</span></button>
      <span className="demo-badge">{tr("只读演示", "Read-only demo")}</span>
      <div className="topbar-actions demo-actions">
        <a className="demo-github" href={repository}><Github size={16} aria-hidden="true" />GitHub</a>
        <a className="demo-install" href={repository + "/releases"}>{tr("安装扩展", "Install extension")}</a>
        <button type="button" className="icon-button" onClick={changeLanguage} aria-label={tr("切换为英文", "Switch to Chinese")} title={tr("切换为英文", "Switch to Chinese")}><Languages size={17} aria-hidden="true" /></button>
        <button type="button" className="icon-button" aria-label={tr("切换主题", "Switch theme")} title={tr("切换主题", "Switch theme")} onClick={() => {
          const next = theme === "light" ? "dark" : "light";
          setTheme(next); savePreference("theme", next);
        }}>{theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</button>
      </div>
    </header>
    <div className="workspace-shell">
      <ProjectExampleContext.Provider value={readers}>
        <WorkspaceEvidenceContext.Provider value={{ open, close, active: source && !original ? { ...source.options, shown: source.reference } : undefined }}>
          <div className={source && !original ? "focus-workspace has-original-panel" : "focus-workspace"}>
            <div className="project-reading-base" ref={readingBase} aria-hidden={Boolean(original) || undefined}>
              <nav id="demo-project-navigation" className={navigationOpen ? "reading-outline is-mobile-open" : "reading-outline"} aria-label={tr("项目导航", "Project navigation")}>
                <button type="button" className="project-mobile-nav-close" onClick={() => setNavigationOpen(false)}>{tr("关闭项目导航", "Close project navigation")}</button>
                <ReaderBackButton onClick={readOverview} label={tr("返回示例总览", "Back to example overview")} />
                <h2>{session.title}</h2>
                <button type="button" className="outline-item" aria-current={isOverview ? "page" : undefined} onClick={readOverview}><LayoutDashboard size={18} aria-hidden="true" /><strong>{tr("文档总览", "Document overview")}</strong></button>
                <div className="project-navigation-tabs" role="tablist" aria-label={tr("项目目录", "Project directory")} onKeyDown={event => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? "wiki" : event.key === "End" ? "sources" : navigationTab === "wiki" ? "sources" : "wiki";
                  setNavigationTab(next);
                  event.currentTarget.querySelector<HTMLButtonElement>("#demo-tab-" + next)?.focus();
                }}>
                  <button type="button" role="tab" id="demo-tab-wiki" aria-controls="demo-navigation-list" aria-selected={navigationTab === "wiki"} tabIndex={navigationTab === "wiki" ? 0 : -1} onClick={() => setNavigationTab("wiki")}>Wiki</button>
                  <button type="button" role="tab" id="demo-tab-sources" aria-controls="demo-navigation-list" aria-selected={navigationTab === "sources"} tabIndex={navigationTab === "sources" ? 0 : -1} onClick={() => setNavigationTab("sources")}>{tr("来源", "Sources")}<small>{knowledge.conversations.length}</small></button>
                </div>
                <div id="demo-navigation-list" role="tabpanel" aria-labelledby={"demo-tab-" + navigationTab} className="project-navigation-list">
                  {navigationTab === "wiki" ? <ProjectWikiNavigation session={session} activeId={isOverview ? undefined : chapter.id} zh={zh} onRead={read} />
                    : <ProjectSourceList ids={session.sourceConversationIds} conversations={knowledge.conversations} fallbackTitle={() => undefined} zh={zh} onOpen={id => {
                      const references = session.evidence.filter(ref => ref.conversationId === id);
                      if (references[0]) open(references[0], { references });
                    }} />}
                </div>
              </nav>
              <div className="focus-reader-main">
                <div className="focus-reader-toolbar">
                  <button type="button" className="project-mobile-nav-toggle" aria-controls="demo-project-navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(!navigationOpen)}>{tr("项目导航", "Project navigation")}</button>
                  <div className="focus-reader-location"><span>{session.title}</span></div>
                  <div className="focus-reader-toolbar-actions project-document-actions">
                    <button type="button" aria-label={tr("导出", "Export")} title={tr("导出项目", "Export project")} onClick={() => setExportOpen(true)}><Download size={15} aria-hidden="true" /><span>{tr("导出", "Export")}</span></button>
                  </div>
                </div>
                <main className={isOverview ? "focus-reading-body" : "focus-reading-body is-chapter-view"} ref={readingBody} key={route}>
                  <div className="reader-content"><div className="project-reading-document">
                    {isOverview ? <DocumentOverview session={session} zh={zh} onLocate={open} onRead={read} toolsHost={source ? toolsHost : null} pageReading={{ workspace: overview }} />
                      : <WikiDocument key={locale + chapter.id} section={chapter} session={session} zh={zh} structure={null}
                        onLocate={open} onReviewEvidence={review} onCurrent={readOverview} persistSourceMarks={false}
                        toolsHost={source ? toolsHost : null} scrollRef={readingBody} headingTarget={headingTarget} />}
                  </div></div>
                </main>
              </div>
            </div>
            {original && source ? <section className="project-source-reader" aria-label={tr("来源对话", "Source conversation")}>
              <div className="original-reading">
                <div className="source-reader-content">
                  <header className="source-reader-header">
                    <ReaderBackButton onClick={() => setFullSource(false)} label={tr("返回文档", "Back to document")} />
                    <h1>{source.reference.title}</h1>
                  </header>
                  <div className="original-reading-body"><div className="reader-content">
                    <ReaderConversation messages={knowledge.messages.filter(message => message.conversationId === original.id)} zh={zh}
                      focusMessageId={source.reference.messageId} focusExcerpt={source.options.quote} focusPlacement="evidence" highlightTurn={false} />
                  </div></div>
                </div>
              </div>
            </section> : source && <WorkspaceSourcePanel key={locale} session={session} reference={source.reference} references={source.options.references} showSourceTitle
              sectionId={source.options.sectionId} quote={source.options.quote} sourcePassages={source.options.sourcePassages}
              claim={source.options.claim} tableTarget={source.options.tableTarget} zh={zh} mode="view" onClose={close}
              onReader={() => setFullSource(true)} onToolsHost={setToolsHost} points={source.options.points} pointIndex={source.options.pointIndex}
              onPoint={index => {
                const point = source.options.points?.[index];
                if (point) open(point.reference, { ...source.options, claim: point.claim, quote: point.quote, references: point.references, pointIndex: index });
              }}
              locationRevision={source.options.locationRevision} onSelect={reference => open(reference, source.options.sourcePassages ? source.options : {
                ...source.options, claim: undefined, quote: undefined,
              })} />}
          </div>
        </WorkspaceEvidenceContext.Provider>
      </ProjectExampleContext.Provider>
    </div>
    {exportOpen && <Suspense fallback={<p className="sr-only" role="status">{tr("正在打开导出", "Opening export")}</p>}>
      <ProjectExportDialog session={session} zh={zh} onClose={() => setExportOpen(false)} allowCopyMarkdown />
    </Suspense>}
  </div>;
}
