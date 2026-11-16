import {useEffect,useMemo,useRef,useState} from "react";
import {X,Download,ChevronDown} from "lucide-react";
import type {FocusSession} from "../../shared/focus-session";
import {wikiSections} from "../../shared/wiki-navigation";
import {projectMatters} from "../../shared/project-matters";
import {evolutionRecords} from "../../shared/product-evolution";
import {projectAnalysisFilename,projectDocument,projectDocumentFilename,projectLedgerFile,type ProjectExportFormat,type ProjectExportSelection,type ProjectSourceMode} from "../../export/project-document";
import {projectKeyEvidence} from "../../export/project-key-evidence";
import {projectReferenceGroups} from "../../export/project-reference-examples";
import {wikiReadingFormat} from "../../shared/wiki-reading-format";
import {wikiQualityCsvMetrics} from "../../shared/wiki-quality-metrics";
import {projectAnalysisInBackground} from "../project-analysis-background";

export function ProjectExportDialog({session,zh,onClose}:{session:FocusSession;zh:boolean;onClose:()=>void}){
 const l=(cn:string,en:string)=>zh?cn:en,root=useRef<HTMLDivElement>(null),wikiCheckbox=useRef<HTMLInputElement>(null);
 const pages=useMemo(()=>wikiSections(session).filter(page=>page.body.trim()),[session]);
 const [selection,setSelection]=useState<ProjectExportSelection>({overview:true,wikiIds:pages.map(page=>page.id),matters:false,history:false,sources:false,sourceMode:"locators",holderMarks:true});
 const evidenceCount=useMemo(()=>selection.sourceMode==="key"?projectKeyEvidence(session,pages.filter(page=>selection.wikiIds.includes(page.id))).length:0,[session,pages,selection.sourceMode,selection.wikiIds]);
 const sourceDescription={
  locators:l("保留引用编号，方便回到原对话查找。","Keep reference numbers for looking up the original conversation."),
  key:evidenceCount
   ?l(`附上 ${evidenceCount} 条重点记录，包括相关原话、确认结果或引用编号。`,`Includes ${evidenceCount} key records with quotes, confirmations, or reference numbers.`)
   :l("所选章节暂无可附的重点记录。","No key records are available for the selected chapters."),
  excerpts:l("附上所选章节引用的对话片段，方便逐条核对。","Include the conversation excerpts cited in the selected chapters."),
 }[selection.sourceMode??"locators"];
 const [format,setFormat]=useState<ProjectExportFormat>("md"),[status,setStatus]=useState(""),[error,setError]=useState("");
 const [references,setReferences]=useState(false);
 const hasReferences=useMemo(()=>session.wikiKnowledge?.documentType!=="learning"&&pages.some(page=>!page.userEdited&&!page.origin
  &&projectReferenceGroups(wikiReadingFormat(page.body,page,{zh}),true).length>0),[session.wikiKnowledge?.documentType,pages,zh]);
 const legacyMatters=projectMatters(session).length,legacyHistory=evolutionRecords(session).filter(record=>!record.hidden).length;
 const [chaptersOpen,setChaptersOpen]=useState(false);
 const wikiSelected=selection.overview||selection.wikiIds.length>0;
 const allWiki=selection.overview&&selection.wikiIds.length===pages.length;
 useEffect(()=>{if(wikiCheckbox.current)wikiCheckbox.current.indeterminate=wikiSelected&&!allWiki;},[wikiSelected,allWiki]);
 // The knowledge ledger the Wiki is written from goes as its own JSON file, beside the document in any format.
 const [ledger,setLedger]=useState(false),hasLedger=Boolean(session.wikiKnowledge);
 // The generation record (time, requests, tokens) of this project's runs, so an evaluation needs no trip to settings.
 const [analysis,setAnalysis]=useState(false),[busy,setBusy]=useState(false),hasRun=Boolean(session.runId);
 const parts=Number(wikiSelected)+Number(selection.matters)+Number(selection.history);
 const includeReferences=references&&hasReferences;
 const count=parts+Number(includeReferences)+Number(ledger&&hasLedger)+Number(analysis&&hasRun);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLButtonElement>("button")?.focus();return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 const download=async()=>{
  setError("");setStatus("");setBusy(true);
  const save=(text:string,filename:string,mime:string)=>{const url=URL.createObjectURL(new Blob([text],{type:mime}));try{const a=document.createElement("a");a.href=url;a.download=filename;a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}};
  try{
   const referenceWikiFilename=parts?projectDocumentFilename(session,format):undefined;
   const combined=includeReferences&&allWiki&&format==="md";
   const fullReferences=combined?undefined:includeReferences?projectDocument(session,{
    overview:false,wikiIds:pages.map(page=>page.id),sources:false,matters:false,history:false,referenceAppendix:"separate",referenceWikiFilename,
   },"md",zh).referenceFile:undefined;
   if(includeReferences&&!combined&&!fullReferences)throw new Error(l("这个项目暂无可单独导出的参考示例。","This project has no reference examples available for separate export."));
   const file=parts?projectDocument(session,{...selection,referenceAppendix:combined?"separate":"omit",
    referenceWikiFilename:combined||fullReferences?referenceWikiFilename:undefined},format,zh):undefined;
   const referenceFile=file?.referenceFile??fullReferences;
   if(includeReferences&&!referenceFile)throw new Error(l("这个项目暂无可单独导出的参考示例。","This project has no reference examples available for separate export."));
   if(file)save(file.text,file.filename,file.mime);
   if(referenceFile)save(referenceFile.text,referenceFile.filename,referenceFile.mime);
   if(ledger&&session.wikiKnowledge){const file=projectLedgerFile(session);save(file.text,file.filename,file.mime);}
   let missing=false;
   if(analysis&&hasRun){const fullMd=file&&format==="md"&&zh&&allWiki&&selection.sourceMode==="locators"&&selection.holderMarks!==false&&!selection.matters&&!selection.history;const quality=fullMd?{sessionId:session.id,updatedAt:session.updatedAt,metrics:wikiQualityCsvMetrics(file.text)}:undefined;const csv=await projectAnalysisInBackground({runId:session.runId,sourceConversationIds:session.sourceConversationIds,quality});if(csv)save(csv,projectAnalysisFilename(session),"text/csv;charset=utf-8");else missing=true;}
   const done=[file?l("文件","Files"):"",referenceFile?l("参考示例","reference examples"):"",ledger&&hasLedger?l("账本","ledger"):"",analysis&&hasRun&&!missing?l("生成记录","generation record"):""].filter(Boolean);
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
    <div className="project-export-chapters">
     <div className="project-export-chapters-heading" data-selected={wikiSelected||undefined}>
      <label><input ref={wikiCheckbox} type="checkbox" checked={allWiki} onChange={()=>setSelection({...selection,overview:!allWiki,wikiIds:allWiki?[]:pages.map(page=>page.id)})}/>{l("项目 Wiki","Project Wiki")}</label>
      {!!pages.length&&<button type="button" aria-label={l("选择 Wiki 章节","Choose Wiki chapters")} aria-expanded={chaptersOpen} aria-controls="project-export-chapter-list" onClick={()=>setChaptersOpen(value=>!value)}><span>{selection.wikiIds.length}/{pages.length}</span><ChevronDown size={15}/></button>}
     </div>
     {chaptersOpen?<div id="project-export-chapter-list" className="project-export-wiki">{pages.map(page=><label key={page.id}>
      <input type="checkbox" checked={selection.wikiIds.includes(page.id)} onChange={event=>setSelection({...selection,overview:selection.overview||event.target.checked,wikiIds:event.target.checked?[...selection.wikiIds,page.id]:selection.wikiIds.filter(id=>id!==page.id)})}/><span>{page.wikiDisplayTitle||page.title}</span>
     </label>)}</div>:null}
    </div>
    {hasReferences?<label className="project-export-choice project-export-ledger"><input type="checkbox" checked={references} onChange={event=>setReferences(event.target.checked)}/>{l("参考示例","Reference examples")}<small aria-hidden="true">Markdown</small></label>:null}
    {hasLedger?<label className="project-export-choice project-export-ledger"><input type="checkbox" checked={ledger} onChange={event=>setLedger(event.target.checked)}/>{l("知识点账本","Knowledge ledger")}<small>JSON</small></label>:null}
    {hasRun?<label className="project-export-choice project-export-ledger"><input type="checkbox" checked={analysis} onChange={event=>setAnalysis(event.target.checked)}/>{l("生成记录","Generation record")}<small>CSV</small></label>:null}
    </div>
    {legacyMatters||legacyHistory?<details className="project-export-legacy"><summary>{l("以前保存的记录","Previously saved records")}</summary>
     {legacyMatters?<label><input type="checkbox" checked={selection.matters} onChange={event=>setSelection({...selection,matters:event.target.checked})}/>{l("历史事项","Saved matters")}<small>{legacyMatters}</small></label>:null}
     {legacyHistory?<label><input type="checkbox" checked={selection.history} onChange={event=>setSelection({...selection,history:event.target.checked})}/>{l("历史演进","Saved evolution")}<small>{legacyHistory}</small></label>:null}
    </details>:null}
   </fieldset>
   <div className="project-export-options">
    <label className="project-export-format">{l("文件格式","File format")}<span className="project-export-select">
     <select value={format} disabled={!parts} onChange={event=>setFormat(event.target.value as ProjectExportFormat)}><option value="html">{l("网页（可打印 PDF）","HTML (print to PDF)")}</option><option value="md">Markdown</option><option value="txt">{l("纯文本","Plain text")}</option><option value="json">JSON</option></select>
     <ChevronDown size={14} aria-hidden="true"/>
    </span></label>
    <div className="project-export-source">
     <label className="project-export-format">{l("对话来源","Conversation sources")}<span className="project-export-select">
      <select value={selection.sourceMode} disabled={!parts} aria-describedby="project-export-source-description" onChange={event=>setSelection({...selection,sourceMode:event.target.value as ProjectSourceMode})}>
       <option value="locators">{l("只保留引用编号","Reference numbers only")}</option>
       <option value="key">{l("附重点原话和确认","Key quotes & decisions")}</option>
       <option value="excerpts">{l("附章节引用的原话","Cited chapter excerpts")}</option>
      </select>
      <ChevronDown size={14} aria-hidden="true"/>
     </span></label>
     <p id="project-export-source-description" role="status">{sourceDescription}</p>
    </div>
   </div>
  </div>
  <footer><span className="project-export-status" data-state={error?"error":status?"success":undefined} role={error?"alert":"status"}>{error||status||(busy?l("正在准备生成记录…","Preparing generation record…"):l(`已选 ${count} 项`,`${count} selected`))}</span><button type="button" className="primary" disabled={!count||busy} onClick={()=>void download()}><Download size={16}/>{l("导出","Export")}</button></footer>
 </div></div>;
}
