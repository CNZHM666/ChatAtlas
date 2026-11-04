import type { WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { DocumentOverview } from "./DocumentOverview";
import { projectMatters } from "../../shared/project-matters";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { WorkspaceSourcePanel } from "./WorkspaceSourcePanel";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, LayoutDashboard } from "lucide-react";
import { workspaceLayoutExample, exampleSourceMessage, exampleProjectKnowledge, exampleChapterDiagram } from "../workspace-layout-example";
import { ProjectExampleContext } from "../project-example-context";
import { WikiDocument } from "./WikiDocument";
import { ProjectWikiNavigation } from "./ProjectWikiNavigation";
import { saveRouteCard } from "../focus-route";
import { ProjectExportDialog } from "./ProjectExportDialog";
import { ReaderBackButton } from "./ReaderBackButton";
import { ReaderMarkdown } from "./ReaderConversation";
import type { FocusEvidence } from "../../shared/focus-session";
import "../project-outcome.css";
import "../example-project.css";

const readers = { diagram:exampleChapterDiagram, message: exampleSourceMessage, knowledge: exampleProjectKnowledge, exampleChapterDiagram };
/** Real project presentation over isolated, editable fictional knowledge. */
export function WorkspaceLayoutExample({ zh, onClose, overlay = false }: { zh: boolean; onClose: () => void; overlay?: boolean }) {
  const [session, setSession] = useState(workspaceLayoutExample);
  const sessionRef = useRef(session); sessionRef.current = session;
  const [view, setView] = useState<"brief" | "wiki" | "sources">("brief");
  const [sectionId, setSectionId] = useState(session.activeSectionId);
  const [fullSource, setFullSource] = useState(false), [sourceSelection, setSourceSelection] = useState<WorkspaceEvidenceOptions>();
  const [source, setSource] = useState<FocusEvidence>(), [mobileNavigation, setMobileNavigation] = useState(false), [exportOpen, setExportOpen] = useState(false);
  const [wikiEdit, setWikiEdit] = useState<{ title: string; body: string }>();
  const root = useRef<HTMLElement>(null), base = useRef<HTMLDivElement>(null), body = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; root.current?.focus(); return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); }; }, []);
  useEffect(() => { if (exportOpen || source && !fullSource && (base.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth) < 940) base.current?.setAttribute("inert", ""); else base.current?.removeAttribute("inert"); }, [exportOpen, source, fullSource]);
  const section = session.sections.find(item => item.id === sectionId) ?? session.sections[0];
  const navigate = (next: typeof view) => { setView(next); setSource(undefined); setFullSource(false); setMobileNavigation(false); body.current?.scrollTo?.({ top: 0 }); };
  const read = (id: string) => { setSectionId(id); navigate("wiki"); };
  const locate = (ref: FocusEvidence, options?:WorkspaceEvidenceOptions) => { setExportOpen(false); setFullSource(false); setSource(ref); setSourceSelection(options); setMobileNavigation(false); };
  const maintain = async (projectMaintenance: NonNullable<typeof session.projectMaintenance>) => setSession(value => ({ ...value, projectMaintenance }));
  const navItems = [["brief", zh ? "文档总览" : "Document overview", LayoutDashboard]] as const;
  const content = <ProjectExampleContext.Provider value={readers}><ProjectKnowledgeActions.Provider value={{save:async update=>{const next=update(sessionRef.current);sessionRef.current=next;setSession(next);},read,matter:ref=>{const source=projectMatters(session).find(item=>item.id===ref.id&&item.type===ref.type)?.sources[0];if(source)locate(source);else navigate("sources");}}}><WorkspaceEvidenceContext.Provider value={{open:locate,close:()=>setSource(undefined),active:source&&!fullSource?{...sourceSelection,shown:source}:undefined}}><section ref={root} tabIndex={-1} className={`focus-workspace example-project-workspace${source&&!fullSource?" has-original-panel":""}${overlay ? " is-example-overlay" : ""}`} role={overlay ? "dialog" : "region"} aria-modal={overlay || undefined} aria-label={zh ? "示例项目工作区" : "Example project workspace"} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); if (mobileNavigation) { setMobileNavigation(false); root.current?.querySelector<HTMLButtonElement>(".project-mobile-nav-toggle")?.focus(); } else if (source) setSource(undefined); else if (!wikiEdit) onClose(); }
    if (overlay && event.key === "Tab") { const nodes = Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary') ?? []).filter(node => node.getClientRects().length); const first = nodes[0], last = nodes.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}>
    <div ref={base} className="project-reading-base">
      <nav id="example-project-navigation" className={`reading-outline${mobileNavigation ? " is-mobile-open" : ""}`} aria-label={zh ? "示例项目导航" : "Example project navigation"}>
        <button type="button" className="project-mobile-nav-close" onClick={() => setMobileNavigation(false)}>{zh ? "关闭项目导航" : "Close navigation"}</button>
        <ReaderBackButton onClick={onClose} label={zh ? "返回工作台" : "Back to Workbench"} />
        <h2>{session.title}</h2>
        {navItems.map(([id, label, Icon]) => <button type="button" key={id} className="outline-item" disabled={Boolean(wikiEdit)} aria-current={view === id && !(source && fullSource) ? "page" : undefined} onClick={() => navigate(id)}><Icon size={18} aria-hidden="true" /><strong>{label}</strong></button>)}
        <h3>Wiki</h3>
        <ProjectWikiNavigation session={session} activeId={view === "wiki" ? sectionId : undefined} zh={zh} onRead={id => { if (!wikiEdit) read(id); }} disabled={Boolean(wikiEdit)} onCreatePage={async(title,body,group)=>{const current=sessionRef.current,id="example-wiki:"+crypto.randomUUID();const sections=saveRouteCard(current.sections,{id,title,body,transition:""}).map(item=>item.id===id?{...item,wikiGroup:group||undefined,wikiGroupEdited:true}:item);const next={...current,sections,wikiOrder:[...(current.wikiOrder??current.sections.map(item=>item.id)),id],updatedAt:Date.now()};sessionRef.current=next;setSession(next);return id;}} onCollapse={(group, collapsed) => setSession(value => ({ ...value, wikiCollapsedGroups: { ...value.wikiCollapsedGroups, [group]: collapsed } }))} />
        <button type="button" className="outline-item" disabled={Boolean(wikiEdit)} aria-current={view === "sources" && !(source && fullSource) ? "page" : undefined} onClick={() => navigate("sources")}><FileText size={18} aria-hidden="true" /><strong>{zh ? "来源与讨论" : "Sources and discussions"}</strong></button>
      </nav>
      <div className="focus-reader-main">
        <div className="focus-reader-toolbar"><button type="button" className="project-mobile-nav-toggle" aria-controls="example-project-navigation" aria-expanded={mobileNavigation} onClick={() => setMobileNavigation(!mobileNavigation)}>{zh ? "项目导航" : "Project navigation"}</button><div className="focus-reader-location"><span>{session.title}</span><small title={zh ? "虚构内容；编辑仅保留在本次体验，不写入你的项目。" : "Fictional content; edits stay in this visit without changing your projects."}>{zh ? "示例项目 · 修改不保存" : "Example project · temporary edits"}</small></div><div className="focus-reader-toolbar-actions"><button type="button" onClick={() => setExportOpen(true)} disabled={Boolean(wikiEdit)}>{zh ? "导出" : "Export"}</button><button type="button" onClick={onClose}>{zh ? "退出示例" : "Exit example"}</button></div></div>
        <main ref={body} className={`focus-reading-body${view === "wiki" && !(source&&fullSource) ? " is-chapter-view" : ""}`} aria-label={zh ? "示例项目内容" : "Example project content"}><div className="reader-content">
          {source && fullSource ? <article className="example-source-reader"><button type="button" className="reader-text-action" onClick={() => setFullSource(false)}>{zh ? "返回项目" : "Back to project"}</button><header className="reader-section-heading"><small className="muted">{zh ? "原始讨论 · 虚构示例" : "Original discussion · fictional example"}</small><h1>{source.title}</h1></header><div className="example-original-message"><small>{zh ? "用户" : "User"}</small><ReaderMarkdown content={exampleSourceMessage(source)?.content ?? source.excerpt} zh={zh} /></div></article>
          : view === "brief" ? <DocumentOverview session={session} zh={zh} onLocate={locate} onRead={read} onSources={() => navigate("sources")} onMaintain={maintain}/>
          : view === "wiki" ? <WikiDocument key={section.id} section={section} session={session} zh={zh} structure={null} onLocate={locate} onCurrent={() => navigate("brief")} onEdit={() => setWikiEdit({ title: section.title, body: section.body })} onFinishEdit={wikiEdit ? () => { setSession(value => ({ ...value, sections: value.sections.map(item => item.id === section.id ? { ...item, ...wikiEdit, userEdited: true } : item) })); setWikiEdit(undefined); } : undefined} editor={wikiEdit ? <div className="focus-editor"><input aria-label={zh ? "章节标题" : "Section title"} value={wikiEdit.title} onChange={event => setWikiEdit({ ...wikiEdit, title: event.target.value })} /><textarea aria-label={zh ? "章节内容" : "Section content"} value={wikiEdit.body} onChange={event => setWikiEdit({ ...wikiEdit, body: event.target.value })} /><button type="button" onClick={() => setWikiEdit(undefined)}>{zh ? "取消编辑" : "Cancel edit"}</button></div> : undefined} />
          : <section className="example-project-sources"><header className="reader-section-heading"><h1>{zh ? "来源与讨论" : "Sources and discussions"}</h1></header><div className="reading-list">{session.evidence.map(ref => <button type="button" key={ref.id} onClick={() => locate(ref)}><span><strong>{ref.title}</strong><small>{new Date(exampleSourceMessage(ref)?.createdAt ?? session.createdAt).toLocaleDateString(zh ? "zh-CN" : "en")}</small></span><span aria-hidden="true">→</span></button>)}</div></section>}


        </div></main>
      </div>
    </div>
    {source && !fullSource ? <WorkspaceSourcePanel session={session} reference={source} references={sourceSelection?.references} sectionId={sourceSelection?.sectionId} quote={sourceSelection?.quote} claim={sourceSelection?.claim} zh={zh} onSelect={ref=>{setSource(ref);setSourceSelection(value=>value?{...value,quote:undefined,claim:undefined}:value);}} onClose={()=>setSource(undefined)} onReader={()=>setFullSource(true)} /> : null}
    {exportOpen ? <ProjectExportDialog session={session} zh={zh} onClose={() => setExportOpen(false)} /> : null}
  </section></WorkspaceEvidenceContext.Provider></ProjectKnowledgeActions.Provider></ProjectExampleContext.Provider>;
  return overlay ? createPortal(content, document.body) : content;
}
