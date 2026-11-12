import {useEffect,useMemo,useRef,useState} from "react";
import {X,Download,ChevronDown} from "lucide-react";
import type {FocusSession} from "../../shared/focus-session";
import {wikiSections} from "../../shared/wiki-navigation";
import {projectMatters} from "../../shared/project-matters";
import {evolutionRecords} from "../../shared/product-evolution";
import {projectAnalysisFilename,projectDocument,projectLedgerFile,type ProjectExportFormat,type ProjectExportSelection} from "../../export/project-document";
import {projectAnalysisInBackground} from "../project-analysis-background";

export function ProjectExportDialog({session,zh,onClose}:{session:FocusSession;zh:boolean;onClose:()=>void}){
 const l=(cn:string,en:string)=>zh?cn:en,root=useRef<HTMLDivElement>(null),wikiCheckbox=useRef<HTMLInputElement>(null);
 const pages=useMemo(()=>wikiSections(session).filter(page=>page.body.trim()),[session]);
 const [selection,setSelection]=useState<ProjectExportSelection>({overview:true,wikiIds:pages.map(page=>page.id),matters:false,history:false,sources:false,holderMarks:true});
 const [format,setFormat]=useState<ProjectExportFormat>("md"),[status,setStatus]=useState(""),[error,setError]=useState("");
 const legacyMatters=projectMatters(session).length,legacyHistory=evolutionRecords(session).filter(record=>!record.hidden).length;
 const [chaptersOpen,setChaptersOpen]=useState(false);
 useEffect(()=>{if(wikiCheckbox.current)wikiCheckbox.current.indeterminate=selection.wikiIds.length>0&&selection.wikiIds.length<pages.length;},[selection.wikiIds.length,pages.length]);
 // The knowledge ledger the Wiki is written from goes as its own JSON file, beside the document in any format.
 const [ledger,setLedger]=useState(false),hasLedger=Boolean(session.wikiKnowledge);
 // The generation record (time, requests, tokens) of this project's runs, so an evaluation needs no trip to settings.
 const [analysis,setAnalysis]=useState(false),[busy,setBusy]=useState(false),hasRun=Boolean(session.runId);
 const parts=Number(selection.overview)+selection.wikiIds.length+Number(selection.matters)+Number(selection.history),count=parts+Number(ledger&&hasLedger)+Number(analysis&&hasRun);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLButtonElement>("button")?.focus();return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 const download=async()=>{
  setError("");setStatus("");setBusy(true);
  const save=(text:string,filename:string,mime:string)=>{const url=URL.createObjectURL(new Blob([text],{type:mime}));try{const a=document.createElement("a");a.href=url;a.download=filename;a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}};
  try{
   if(parts){const file=projectDocument(session,selection,format,zh);save(file.text,file.filename,file.mime);}
   if(ledger&&session.wikiKnowledge){const file=projectLedgerFile(session);save(file.text,file.filename,file.mime);}
   let missing=false;
   if(analysis&&hasRun){const csv=await projectAnalysisInBackground(session);if(csv)save(csv,projectAnalysisFilename(session),"text/csv;charset=utf-8");else missing=true;}
   const done=[parts?l("文件","Files"):"",ledger&&hasLedger?l("账本","ledger"):"",analysis&&hasRun&&!missing?l("生成记录","generation record"):""].filter(Boolean);
   setStatus(missing&&!done.length?l("这个项目没有可导出的生成记录","This project has no generation record to export"):`${done.join(l("和"," and "))}${l("已导出"," exported")}${missing?l("；这个项目没有可导出的生成记录","; this project has no generation record"):""}`);
  }
  catch(failure){setError(failure instanceof Error?failure.message:String(failure));}
  finally{setBusy(false);}
 };
 return <div className="ai-context-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><div ref={root} className="ai-context-dialog project-export-dialog" role="dialog" aria-modal="true" aria-labelledby="project-export-title" onKeyDown={event=>{
  if(event.key==="Escape"){event.stopPropagation();onClose();}
  if(event.key==="Tab"){const elements=[...root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')??[]].filter(element=>element.getClientRects().length);const first=elements[0],last=elements.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }}>
  <header><div><h2 id="project-export-title">{l("导出项目文件","Export project files")}</h2><p title={session.title}>{session.title}</p></div><button type="button" aria-label={l("关闭导出","Close export")} onClick={onClose}><X size={20}/></button></header>
  <div className="project-export-body">
   <fieldset><legend>{l("导出内容","Content")}</legend>
    <div className="project-export-selection">
    <label className="project-export-choice"><input type="checkbox" checked={selection.overview} onChange={event=>setSelection({...selection,overview:event.target.checked})}/>{l("项目总览","Project overview")}</label>
    <div className="project-export-chapters"><div className="project-export-chapters-heading"><label><input ref={wikiCheckbox} type="checkbox" disabled={!pages.length} checked={pages.length>0&&selection.wikiIds.length===pages.length} onChange={event=>setSelection({...selection,wikiIds:event.target.checked?pages.map(page=>page.id):[]})}/>{l("Wiki 章节","Wiki chapters")}</label><button type="button" disabled={!pages.length} aria-label={l("选择 Wiki 章节","Choose Wiki chapters")} aria-expanded={chaptersOpen} aria-controls="project-export-chapter-list" onClick={()=>setChaptersOpen(value=>!value)}><span>{selection.wikiIds.length}/{pages.length}</span><ChevronDown size={15}/></button></div>{chaptersOpen?<div id="project-export-chapter-list" className="project-export-wiki">{pages.map(page=><label key={page.id}><input type="checkbox" checked={selection.wikiIds.includes(page.id)} onChange={event=>setSelection({...selection,wikiIds:event.target.checked?[...selection.wikiIds,page.id]:selection.wikiIds.filter(id=>id!==page.id)})}/><span>{page.wikiDisplayTitle||page.title}</span></label>)}</div>:null}</div>
    {hasLedger?<label className="project-export-choice project-export-ledger"><input type="checkbox" checked={ledger} onChange={event=>setLedger(event.target.checked)}/>{l("知识点账本","Knowledge ledger")}<small>JSON</small></label>:null}
    {hasRun?<label className="project-export-choice project-export-ledger"><input type="checkbox" checked={analysis} onChange={event=>setAnalysis(event.target.checked)}/>{l("生成记录","Generation record")}<small>CSV</small></label>:null}
    </div>
    {legacyMatters||legacyHistory?<details className="project-export-legacy"><summary>{l("以前保存的记录","Previously saved records")}</summary>
     {legacyMatters?<label><input type="checkbox" checked={selection.matters} onChange={event=>setSelection({...selection,matters:event.target.checked})}/>{l("历史事项","Saved matters")}<small>{legacyMatters}</small></label>:null}
     {legacyHistory?<label><input type="checkbox" checked={selection.history} onChange={event=>setSelection({...selection,history:event.target.checked})}/>{l("历史演进","Saved evolution")}<small>{legacyHistory}</small></label>:null}
    </details>:null}
   </fieldset>
   <div className="project-export-options"><label className="project-export-format">{l("文件格式","File format")}<select value={format} onChange={event=>setFormat(event.target.value as ProjectExportFormat)}><option value="html">{l("网页（可打印 PDF）","HTML (print to PDF)")}</option><option value="md">Markdown</option><option value="txt">{l("纯文本","Plain text")}</option><option value="json">JSON</option></select></label><label className="project-export-source"><input type="checkbox" checked={selection.sources} onChange={event=>setSelection({...selection,sources:event.target.checked})}/>{l("附来源摘录","Include source excerpts")}</label></div>
  </div>
  <footer><span className="project-export-status" data-state={error?"error":status?"success":undefined} role={error?"alert":"status"}>{error||status||(busy?l("正在准备生成记录…","Preparing generation record…"):l(`已选 ${count} 项`,`${count} selected`))}</span><button type="button" className="primary" disabled={!count||busy} onClick={()=>void download()}><Download size={16}/>{l("导出","Export")}</button></footer>
 </div></div>;
}
