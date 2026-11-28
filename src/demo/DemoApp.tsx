import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Download, Github, Languages, LayoutDashboard, Moon, PanelRightOpen, Settings, Sun } from "lucide-react";
import { DocumentOverview } from "../canvas/components/DocumentOverview";
import { MapSidebar } from "../canvas/components/MapSidebar";
import { ProjectNavigationLayout, ProjectNavigationOpen, useProjectNavigationLayout } from "../canvas/components/ProjectNavigationLayout";
import { ProjectSourceList } from "../canvas/components/ProjectSourceList";
import { ProjectWikiNavigation } from "../canvas/components/ProjectWikiNavigation";
import { ReaderBackButton } from "../canvas/components/ReaderBackButton";
import { ReaderConversation } from "../canvas/components/ReaderConversation";
import { WikiDocument } from "../canvas/components/WikiDocument";
import { WorkspaceSourcePanel } from "../canvas/components/WorkspaceSourcePanel";
import { ProjectExampleContext } from "../canvas/project-example-context";
import { WorkspaceEvidenceContext, type WorkspaceEvidenceOptions } from "../canvas/workspace-evidence-context";
import { PreferencesProvider, usePreferences, type Locale, type Theme } from "../canvas/preferences";
import { BrandMark } from "../shared/BrandMark";
import { OVERVIEW_CANVAS_ID } from "../shared/constants";
import type { FocusEvidence } from "../shared/focus-session";
import { architectureChapter, demoProject, type DemoLocale } from "./project";
import { ContinuationDemo } from "./ContinuationDemo";

const ProjectExportDialog = lazy(() => import("../canvas/components/ProjectExportDialog").then(module => ({ default: module.ProjectExportDialog })));
const ReviewHome = lazy(() => import("../canvas/components/ReviewHome").then(module => ({ default: module.ReviewHome })));
const SettingsPanel = lazy(() => import("../canvas/components/SettingsPanel").then(module => ({ default: module.SettingsPanel })));
const repository = "https://github.com/CNZHM666/ChatAtlas";
const installUrl = repository + "/releases";

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
  return <PreferencesProvider initialLocale={initialLocale() === "zh" ? "zh-CN" : "en"} initialTheme={readPreference("theme") === "dark" ? "dark" : "light"}
    onLocaleChange={saveLocale} onThemeChange={saveTheme}><DemoWorkspace /></PreferencesProvider>;
}

function saveLocale(locale: Locale) {
  const value = locale === "zh-CN" ? "zh" : "en", url = new URL(location.href);
  url.searchParams.set("lang", value);
  history.replaceState(history.state, "", url);
  savePreference("lang", value);
}

function saveTheme(theme: Theme) { savePreference("theme", theme); }

function DemoWorkspace() {
  const { locale: uiLocale, setLocale, theme, setTheme } = usePreferences();
  const locale = uiLocale === "zh-CN" ? "zh" : "en";
  const [routeHash, setRoute] = useState(() => location.hash.slice(1));
  const [source, setSource] = useState<{ reference: FocusEvidence; options: WorkspaceEvidenceOptions }>();
  const [fullSource, setFullSource] = useState(false);
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [navigationTab, setNavigationTab] = useState<"wiki" | "sources">("wiki");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settings, setSettings] = useState<"ai" | "data">();
  const [needsExtension, setNeedsExtension] = useState(false);
  const [continuationOpen, setContinuationOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const navigationLayout = useProjectNavigationLayout();
  const [headingTarget, setHeadingTarget] = useState<{ title: string; revision: number }>();
  const readingBody = useRef<HTMLElement>(null);
  const readingBase = useRef<HTMLDivElement>(null);
  const zh = locale === "zh", tr = (cn: string, en: string) => zh ? cn : en;
  const { knowledge, overview } = useMemo(() => demoProject(locale), [locale]);
  const session = knowledge.session;
  const defaultRoute = "/wiki/" + architectureChapter;
  const route = ["/search", "/workbench/history"].includes(routeHash) ? "/workbench"
    : ["/overview", "/workbench"].includes(routeHash) || session.sections.some(section => "/wiki/" + section.id === routeHash)
      ? routeHash : defaultRoute;
  const canvases = useMemo(() => [
    { id: OVERVIEW_CANVAS_ID, name: "Workbench", type: "overview" as const, createdAt: session.createdAt, updatedAt: session.updatedAt },
    { id: session.canvasId ?? session.id, name: session.title, type: "topic" as const, createdAt: session.createdAt, updatedAt: session.updatedAt },
  ], [session]);
  const readers = useMemo(() => ({
    message: (reference: FocusEvidence) => knowledge.messages.find(message => message.id === reference.messageId && message.conversationId === reference.conversationId),
    knowledge: () => knowledge,
  }), [knowledge]);
  const chapter = session.sections.find(section => route === "/wiki/" + section.id) ?? session.sections.find(section => section.id === architectureChapter)!;
  const isOverview = route === "/overview";
  const isHome = route === "/workbench";
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
    setExportOpen(false);
    setNeedsExtension(false);
    setHeadingTarget(heading ? { title: heading, revision: performance.now() } : undefined);
    if (!heading) readingBody.current?.scrollTo({ top: 0 });
    setRoute(next);
    if (location.hash.slice(1) !== next) history.pushState(null, "", "#" + next);
  };
  const read = (id: string, heading?: string) => { setNavigationTab("wiki"); navigate("/wiki/" + id, heading); };
  const readOverview = () => navigate("/overview");
  const readHome = () => navigate("/workbench");
  const requireExtension = () => setNeedsExtension(true);
  const readConversation = (id: string, message?: (typeof knowledge.messages)[number]) => {
    const references = session.evidence.filter(ref => ref.conversationId === id);
    const reference = references.find(ref => ref.messageId === message?.id) ?? references[0];
    if (!reference) return;
    navigate("/overview");
    setNavigationTab("sources");
    open(reference, { references, reader: true });
  };
  const review = () => {
    const sourcePassages = (chapter.claims ?? []).flatMap(claim => claim.evidenceIds.map(referenceId => ({ referenceId, quote: claim.quote })));
    const references = chapter.evidenceIds.flatMap(id => session.evidence.find(ref => ref.id === id) ?? []);
    if (references[0]) open(references[0], { references, sourcePassages, sectionId: chapter.id, mode: "view" });
  };
  useEffect(() => {
    if (routeHash && routeHash !== route && location.hash.slice(1) === routeHash) {
      history.replaceState(history.state, "", "#" + route);
      setRoute(route);
    }
  }, [routeHash, route]);
  useEffect(() => {
    const onHash = () => {
      const next = location.hash.slice(1);
      setRoute(next);
      setSource(undefined);
      setFullSource(false);
      setExportOpen(false);
      setSettings(undefined);
      setHeadingTarget(undefined);
      setNeedsExtension(false);
      setNavigationOpen(false);
    };
    window.addEventListener("hashchange", onHash);
    return () => { window.removeEventListener("hashchange", onHash); };
  }, []);
  useEffect(() => {
    document.title = zh ? "ChatAtlas · 只读演示" : "ChatAtlas · Read-only demo";
  }, [zh]);
  useEffect(() => {
    const base = readingBase.current;
    if (!original || !base) return;
    base.inert = true;
    return () => { base.inert = false; };
  }, [original]);
  const changeLanguage = () => {
    setLocale(zh ? "en" : "zh-CN");
    close();
  };

  return <div className={`app-shell demo-shell${isHome ? " is-canvas-view" : ""}`}>
    <header className="topbar">
      <button type="button" className="brand brand-home" onClick={readHome} aria-label={tr("ChatAtlas 工作台", "ChatAtlas Workbench")}><BrandMark className="brand-mark" /><span>ChatAtlas</span></button>
      <span className="demo-badge">{tr("只读演示", "Read-only demo")}</span>
      <div className="topbar-actions demo-actions">
        <button type="button" className="demo-continuation-trigger" onClick={() => setContinuationOpen(true)} aria-label={tr("体验续写", "Try continuation")} title={tr("体验续写", "Try continuation")}><PanelRightOpen size={16} aria-hidden="true"/><span>{tr("体验续写", "Try continuation")}</span></button>
        <a className="demo-github" href={repository}><Github size={16} aria-hidden="true" />GitHub</a>
        <a className="demo-install" href={installUrl}>{tr("安装扩展", "Install extension")}</a>
        <button type="button" className="icon-button" onClick={() => setSettings("ai")} aria-label={tr("设置", "Settings")} title={tr("设置", "Settings")}><Settings size={17} aria-hidden="true" /></button>
        <button type="button" className="icon-button" onClick={changeLanguage} aria-label={tr("切换为英文", "Switch to Chinese")} title={tr("切换为英文", "Switch to Chinese")}><Languages size={17} aria-hidden="true" /></button>
        <button type="button" className="icon-button" aria-label={tr("切换主题", "Switch theme")} title={tr("切换主题", "Switch theme")} onClick={() => {
          setTheme(theme === "light" ? "dark" : "light");
        }}>{theme === "light" ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</button>
      </div>
    </header>
    <div className="workspace-shell">
      {isHome ? <>
        <MapSidebar canvases={canvases} activeId={OVERVIEW_CANVAS_ID} onSelect={id => id === OVERVIEW_CANVAS_ID ? readHome() : readOverview()} />
        <div className="workspace"><Suspense fallback={null}><ReviewHome projectFirst
          canvases={canvases} sessions={[session]} conversations={knowledge.conversations}
          selectedIds={selectedIds} onSelectedIds={setSelectedIds} importJob={null} importSource="web" recentReading={[]}
          onHistoryChange={readHome} onSession={readOverview}
          onReadConversation={readConversation} onPreviewAction={requireExtension} onConfigureAI={() => setSettings("ai")}
          onStart={requireExtension} onResume={readOverview} onSpace={readOverview} onPrioritize={requireExtension} onScan={requireExtension}
          onHydrate={requireExtension} onZip={requireExtension} onPause={requireExtension} onConnect={requireExtension} onDiscover={requireExtension}
        /></Suspense></div>
      </> : <ProjectExampleContext.Provider value={readers}>
        <WorkspaceEvidenceContext.Provider value={{ open, close, active: source && !original ? { ...source.options, shown: source.reference } : undefined }}>
          <div className={source && !original ? "focus-workspace has-original-panel" : "focus-workspace"}
            data-project-navigation-collapsed={navigationLayout.collapsed || undefined} style={navigationLayout.style}>
            <div className="project-reading-base" ref={readingBase} aria-hidden={Boolean(original) || undefined}>
              <ProjectNavigationOpen layout={navigationLayout} zh={zh} navigationId="demo-project-navigation" />
              <nav id="demo-project-navigation" className={navigationOpen ? "reading-outline is-mobile-open" : "reading-outline"}
                hidden={navigationLayout.collapsed && !navigationOpen} aria-label={tr("项目导航", "Project navigation")} onKeyDown={event => {
                  if (event.key !== "Escape" || window.innerWidth > 760) return;
                  setNavigationOpen(false);
                  requestAnimationFrame(() => document.getElementById("demo-project-navigation-open")?.focus());
                }}>
                <ProjectNavigationLayout layout={navigationLayout} zh={zh} navigationId="demo-project-navigation" onCloseMobile={() => setNavigationOpen(false)}>
                  <ReaderBackButton onClick={readHome} label={tr("返回工作台", "Back to Workbench")} />
                </ProjectNavigationLayout>
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
                  <ProjectNavigationOpen layout={navigationLayout} zh={zh} navigationId="demo-project-navigation" mobile onOpenMobile={() => setNavigationOpen(true)} />
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
      </ProjectExampleContext.Provider>}
    </div>
    {exportOpen && <Suspense fallback={<p className="sr-only" role="status">{tr("正在打开导出", "Opening export")}</p>}>
      <ProjectExportDialog session={session} zh={zh} onClose={() => setExportOpen(false)} />
    </Suspense>}
    {settings && <Suspense fallback={null}><SettingsPanel key={settings} initialTab={settings} onClose={() => setSettings(undefined)} installUrl={installUrl} /></Suspense>}
    {continuationOpen && <ContinuationDemo session={session} zh={zh} onClose={() => setContinuationOpen(false)} onEvidence={reference => {
      setContinuationOpen(false);
      read(architectureChapter);
      open(reference, { references: [reference], quote: reference.excerpt, sectionId: architectureChapter });
    }}/>}
    {needsExtension && <div className="demo-action-notice" role="status"><span>{tr("安装扩展后可操作自己的对话。", "Install the extension to work with your own conversations.")}</span>
      <a href={installUrl}>{tr("安装扩展", "Install extension")}</a>
      <button type="button" className="icon-button" onClick={() => setNeedsExtension(false)} aria-label={tr("关闭提示", "Dismiss notice")}>×</button>
    </div>}
  </div>;
}
