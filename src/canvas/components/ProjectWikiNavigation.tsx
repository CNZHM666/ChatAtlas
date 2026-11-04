import {wikiDisplayGroups} from "../../shared/wiki-display-groups";
import { useId, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import type { FocusSession } from "../../shared/focus-session";
import { wikiSections, localizedWikiTitle } from "../../shared/wiki-navigation";
import {wikiDocument} from "../wiki-document";

export function ProjectWikiNavigation({ session, activeId, zh, onRead, adjusting = false, onDone, onCollapse, onEdit, onMove, onCreateGroup, onCreatePage, onDropPage, disabled = false }: {
  session: FocusSession; activeId?: string; zh: boolean; onRead: (id: string,heading?:string) => void;
  adjusting?: boolean; onDone?: () => void; onCollapse?: (group: string, collapsed: boolean) => void;
  onEdit?: (id: string, title: string, group: string, displayTitle?: string) => Promise<void>;
  onMove?: (ids: string[]) => Promise<void>;
  onCreateGroup?: (name: string) => Promise<void>;
  onCreatePage?: (title: string, body: string, group?: string) => Promise<string>;
  disabled?: boolean;
  onDropPage?: (id: string, group: string, before?: string) => Promise<void>;
}) {
  const [newGroup, setNewGroup] = useState<string>();
  const [openSubtopics,setOpenSubtopics]=useState<Record<string,boolean>>({});
  const subtopics=useMemo(()=>new Map(session.sections.map(section=>[section.id,wikiDocument(section.body,!section.userEdited&&!section.origin).headings.filter(heading=>heading.depth===2)])),[session.sections]);
  const [newPage, setNewPage] = useState<{title:string;body:string;group:string}>();
  // One list in directory order: the chapters are few and the category groups added a step without helping reading.
  const categorized=false;
  const dragging = useRef<string>();
  const pointerStart = useRef<{ id: string; x: number; y: number }>();
  const skipClick = useRef(false);
  const [dropTarget, setDropTarget] = useState<string>();
  const [draft, setDraft] = useState<{ id: string; title: string; group: string; displayTitle: string }>();
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [localCollapsed, setLocalCollapsed] = useState(session.wikiCollapsedGroups ?? {});
  const groupListId = useId();
  const grouped = wikiSections(session, zh ? "zh-CN" : "en");
  const rank=new Map((session.wikiOrder??session.sections.map(section=>section.id)).map((id,index)=>[id,index]));
  const ordered = categorized ? grouped : [...grouped].sort((a,b)=>(rank.get(a.id)??session.sections.findIndex(section=>section.id===a.id))-(rank.get(b.id)??session.sections.findIndex(section=>section.id===b.id)));
  const sections = ordered;
  const availableGroups = [...new Set([...(session.wikiGroups ?? []), ...sections.map(section => section.wikiGroup?.trim() ?? "")])];
  // Editing controls retain real destinations; the reading view only projects groups.
  const displayGroups=wikiDisplayGroups(sections,section=>section.wikiGroup??"");
  const groups = categorized ? adjusting?availableGroups:displayGroups.map(group=>group.name) : [""];
  const activeGroup = (!adjusting?displayGroups.find(group=>group.pages.some(section=>section.id===(activeId??session.activeSectionId)))?.name:ordered.find(section=>section.id===(activeId??session.activeSectionId))?.wikiGroup)??groups[0];
  const collapsed = { ...localCollapsed, ...session.wikiCollapsedGroups };
  const save = async (run: () => Promise<void>) => {
    if (saving) return;
    setSaving(true); setError("");
    try { await run(); setDraft(undefined); } catch (failure) { setError(failure instanceof Error && /already exists/.test(failure.message) ? zh ? "章节已存在" : "Chapter already exists" : zh ? "保存失败，请重试" : "Could not save. Retry."); } finally { setSaving(false); }
  };
  const toggle = (group: string, value: boolean) => { setLocalCollapsed(current => ({ ...current, [group]: value })); onCollapse?.(group, value); };
  const destinationAt = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y);
    const chapter = target?.closest<HTMLElement>("[data-wiki-group]");
    if (!chapter || !chapter.closest(".project-wiki-navigation")) return undefined;
    return { group: chapter.dataset.wikiGroup ?? "", before: target?.closest<HTMLElement>("[data-wiki-page]")?.dataset.wikiPage };
  };
  const move = (id: string, other: string) => {
    const ids = ordered.map(section => section.id), from = ids.indexOf(id), to = ids.indexOf(other);
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void save(() => onMove?.(ids) ?? Promise.resolve());
  };
  return <div className={`project-wiki-navigation${adjusting ? " is-adjusting" : ""}`}>
    {adjusting ? <div className="wiki-adjust-heading"><strong>{zh ? "调整目录" : "Edit directory"}</strong><button type="button" disabled={saving || Boolean(draft)} onClick={onDone}>{zh ? "完成" : "Done"}</button></div> : null}
    {onCreateGroup && adjusting && categorized ? <div className="wiki-create-chapter">{newGroup === undefined ? <button type="button" className="wiki-create-button" disabled={saving || Boolean(draft)||Boolean(newPage)} onClick={() => setNewGroup("")}><Plus size={15} />{zh ? "新建分类" : "New category"}</button> : <form className="wiki-page-editor" onSubmit={event => { event.preventDefault(); if (newGroup.trim()) void save(async () => { await onCreateGroup(newGroup.trim()); setNewGroup(undefined); }); }}><label>{zh ? "分类名称" : "Category name"}<input autoFocus maxLength={60} value={newGroup} onChange={event => setNewGroup(event.target.value)} /></label><div><button type="submit" className="primary" disabled={saving || !newGroup.trim()}>{zh ? "创建" : "Create"}</button><button type="button" disabled={saving} onClick={() => setNewGroup(undefined)}>{zh ? "取消" : "Cancel"}</button></div></form>}</div> : null}
    {groups.map((group, index) => {
      const pages = categorized ? adjusting?sections.filter(section => (section.wikiGroup?.trim() ?? "") === group):displayGroups[index].pages : sections;
      const open = Boolean(adjusting || !(collapsed[group] ?? group !== activeGroup));
      const panelId = `${groupListId}-${index}`;
      return <div className={`wiki-directory-group${group ? " is-grouped" : ""}${dropTarget === `group:${group}` ? " is-drop-target" : ""}`} key={group} data-wiki-group={group}
        onDragOver={event => { if (!dragging.current || !onDropPage || !categorized || saving) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(`group:${group}`); }}
        onDrop={event => { if (!dragging.current || !onDropPage || !categorized || saving) return; event.preventDefault(); const id = dragging.current; dragging.current = undefined; setDropTarget(undefined); void save(() => onDropPage(id, group)); }}>
        {group ? <button type="button" className="wiki-group-toggle" aria-expanded={open} aria-controls={panelId} disabled={adjusting} onClick={() => toggle(group, open)}>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<span>{group}</span></button> : null}
        <div id={panelId} hidden={Boolean(group) && !open}>{pages.map((section, pageIndex) => <div className={`wiki-page-row${dropTarget === section.id ? " is-drop-before" : ""}`} key={section.id} data-wiki-page={section.id} draggable={adjusting && categorized && Boolean(onDropPage) && !saving && !draft && newGroup === undefined}
          onDragStart={event => { dragging.current = section.id; event.dataTransfer.setData("text/plain", section.id); event.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => { dragging.current = undefined; setDropTarget(undefined); }}
          onDragOver={event => { if (!dragging.current || !onDropPage || !categorized || saving || dragging.current === section.id) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDropTarget(section.id); }}
          onDrop={event => { if (!dragging.current || !onDropPage || !categorized || saving) return; event.preventDefault(); event.stopPropagation(); const id = dragging.current; dragging.current = undefined; setDropTarget(undefined); if (id !== section.id) void save(() => onDropPage(id, group, section.id)); }}>
          <div className={`wiki-page-heading${!adjusting&&subtopics.get(section.id)?.length?" has-subtopics":""}`}><button type="button" className="outline-item" aria-current={activeId === section.id ? "page" : undefined}
            onPointerDown={event => { if (!adjusting || !categorized || !onDropPage || event.button !== 0 || saving || draft || newGroup !== undefined) return; event.preventDefault(); event.currentTarget.focus(); skipClick.current = false; pointerStart.current = { id: section.id, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
            onPointerMove={event => { const start = pointerStart.current; if (!start || start.id !== section.id) return; if (!dragging.current && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return; dragging.current = section.id; const target = destinationAt(event.clientX, event.clientY); setDropTarget(target ? target.before ?? `group:${target.group}` : undefined); }}
            onPointerUp={event => { const id = dragging.current, target = id ? destinationAt(event.clientX, event.clientY) : undefined; pointerStart.current = undefined; dragging.current = undefined; setDropTarget(undefined); if (id === section.id) { skipClick.current = true; if (onDropPage && target && target.before !== id) void save(() => onDropPage(id, target.group, target.before)); } }}
            onPointerCancel={() => { pointerStart.current = undefined; dragging.current = undefined; setDropTarget(undefined); }}
            onClick={event => { if (skipClick.current && event.detail !== 0) { skipClick.current = false; return; } skipClick.current = false; if(categorized)toggle(group, false); onRead(section.id); }}><span>{ordered.findIndex(page => page.id === section.id) + 1}</span><strong title={section.title}>{section.wikiDisplayTitle || localizedWikiTitle(section,zh)}</strong></button>
          {!adjusting&&Boolean(subtopics.get(section.id)?.length)?<button type="button" className="wiki-subtopic-toggle" disabled={disabled||saving} aria-label={zh?`${openSubtopics[section.id]?"收起":"展开"}${section.title}的子主题`:`${openSubtopics[section.id]?"Collapse":"Expand"} subtopics of ${section.title}`} title={zh?`${subtopics.get(section.id)!.length} 个子主题`:`${subtopics.get(section.id)!.length} subtopics`} aria-expanded={Boolean(openSubtopics[section.id])} aria-controls={`${groupListId}-topics-${encodeURIComponent(section.id)}`} onClick={()=>setOpenSubtopics(current=>({...current,[section.id]:!current[section.id]}))}>{openSubtopics[section.id]?<ChevronDown size={16} aria-hidden="true"/>:<ChevronRight size={16} aria-hidden="true"/>}</button>:null}</div>
          {!adjusting&&Boolean(subtopics.get(section.id)?.length)?<nav className="wiki-subtopics" hidden={!openSubtopics[section.id]} id={`${groupListId}-topics-${encodeURIComponent(section.id)}`} aria-label={`${section.title} · ${zh?"子主题":"Subtopics"}`}>{subtopics.get(section.id)!.map((heading,index)=><button type="button" key={`${heading.title}:${index}`} onClick={()=>onRead(section.id,heading.title)}>{heading.title}</button>)}</nav>:null}
          {adjusting ? <div className="wiki-page-actions"><button type="button" title={zh ? "修改标题与分组" : "Edit title and group"} aria-label={`${zh ? "修改" : "Edit"} ${section.title}`} disabled={saving || Boolean(draft)} onClick={() => setDraft({ id: section.id, title: section.title, group:section.wikiGroup??"", displayTitle:section.wikiDisplayTitle || "" })}><Pencil size={14} /></button><button type="button" aria-label={`${zh ? "上移" : "Move up"} ${section.title}`} disabled={saving || Boolean(draft) || pageIndex === 0} onClick={() => move(section.id, pages[pageIndex - 1].id)}><ArrowUp size={14} /></button><button type="button" aria-label={`${zh ? "下移" : "Move down"} ${section.title}`} disabled={saving || Boolean(draft) || pageIndex === pages.length - 1} onClick={() => move(section.id, pages[pageIndex + 1].id)}><ArrowDown size={14} /></button></div> : null}
          {adjusting && draft?.id === section.id ? <form className="wiki-page-editor" onSubmit={event => { event.preventDefault(); if (draft.title.trim()) void save(() => onEdit?.(draft.id, draft.title.trim(), draft.group.trim(), draft.displayTitle.trim()) ?? Promise.resolve()); }}><label>{zh ? "标题" : "Title"}<input autoFocus maxLength={180} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label><label>{zh ? "导航短名（可选）" : "Short navigation name (optional)"}<input maxLength={40} value={draft.displayTitle} onChange={event=>setDraft({...draft,displayTitle:event.target.value})}/></label><label>{zh ? "分组" : "Group"}<input list={`${groupListId}-choices`} maxLength={60} placeholder={zh ? "不分组" : "Ungrouped"} value={draft.group} onChange={event => setDraft({ ...draft, group: event.target.value })} /></label><div><button type="submit" className="primary" disabled={saving || !draft.title.trim()}>{zh ? "保存" : "Save"}</button><button type="button" disabled={saving} onClick={() => { setDraft(undefined); setError(""); }}>{zh ? "取消" : "Cancel"}</button></div></form> : null}
        </div>)}{!pages.length ? <p className="wiki-empty-chapter">{zh ? "拖动页面标题到这里" : "Drag a page title here"}</p> : null}</div>
      </div>;
    })}
    {onCreatePage?<div className="wiki-create-page">{!newPage?<button type="button" className="wiki-create-button" disabled={disabled||saving||Boolean(draft)||newGroup!==undefined} onClick={()=>{setError("");setNewPage({title:"",body:"",group:""});}}><Plus size={15} aria-hidden="true"/>{zh?"新增章节":"Add chapter"}</button>:<form className="wiki-page-editor" onSubmit={event=>{event.preventDefault();if(newPage.title.trim())void save(async()=>{const id=await onCreatePage(newPage.title.trim(),newPage.body,newPage.group);setNewPage(undefined);onRead(id);});}}><label>{zh?"章节标题":"Chapter title"}<input autoFocus required maxLength={180} disabled={saving} value={newPage.title} onChange={event=>setNewPage({...newPage,title:event.target.value})}/></label><label>{zh?"章节内容（可选）":"Chapter content (optional)"}<textarea rows={4} disabled={saving} value={newPage.body} onChange={event=>setNewPage({...newPage,body:event.target.value})}/></label>{categorized?<label>{zh?"分类（可选）":"Category (optional)"}<select disabled={saving} value={newPage.group} onChange={event=>setNewPage({...newPage,group:event.target.value})}><option value="">{zh?"不分类":"Uncategorized"}</option>{availableGroups.filter(Boolean).map(group=><option key={group}>{group}</option>)}</select></label>:null}<div><button type="submit" className="primary" disabled={saving||!newPage.title.trim()}>{zh?"创建":"Create"}</button><button type="button" disabled={saving} onClick={()=>{setNewPage(undefined);setError("");}}>{zh?"取消":"Cancel"}</button></div></form>}</div>:null}
    <datalist id={`${groupListId}-choices`}>{availableGroups.filter(Boolean).map(group => <option key={group} value={group} />)}</datalist>
    {error ? <p role="alert">{error}</p> : null}{!groups.length ? <p className="muted">{zh ? "暂无 Wiki 页面" : "No Wiki pages yet"}</p> : null}
  </div>;
}
