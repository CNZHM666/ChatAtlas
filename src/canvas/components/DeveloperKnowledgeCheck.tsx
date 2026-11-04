import {useEffect,useRef,useState} from "react";
import {listFocusSessions} from "../../storage/focus-sessions";
import type {FocusSession} from "../../shared/focus-session";
import {checkProjectKnowledge,knowledgeCheckExport,type ProjectKnowledgeCheck} from "../project-knowledge-checks";

export function DeveloperKnowledgeCheck({zh,onResult}:{zh:boolean;onResult?:(result:ReturnType<typeof knowledgeCheckExport>)=>void}){
 const [opened,setOpened]=useState(false),[sessions,setSessions]=useState<FocusSession[]>([]),[selected,setSelected]=useState(""),[result,setResult]=useState<ProjectKnowledgeCheck>(),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),l=(cn:string,en:string)=>zh?cn:en;
 useEffect(()=>{
  if(!opened)return;const counter=generation,token=++counter.current;setLoading(true);setError("");setResult(undefined);
  void listFocusSessions().then(rows=>{if(generation.current!==token)return;const saved=rows.filter(row=>row.mode==="work"&&row.status!=="preview");setSessions(saved);setSelected(value=>saved.some(row=>row.id===value)?value:saved[0]?.id??"");}).catch(()=>{if(generation.current===token)setError(l("读取项目失败，请重新展开。","Could not load projects. Close and reopen."));}).finally(()=>{if(generation.current===token)setLoading(false);});
  return()=>{counter.current++;};
  // Only explicit opening loads saved projects; language changes do not reread.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[opened]);
 const run=()=>{const session=sessions.find(row=>row.id===selected);if(!session)return;try{const next=checkProjectKnowledge(session,zh);setResult(next);onResult?.(knowledgeCheckExport(next));setError("");}catch{setError(l("检查未完成，项目内容没有改变。","Check failed; project content is unchanged."));}};
 return <details className="developer-knowledge-check" onToggle={event=>{if(event.target===event.currentTarget)setOpened(event.currentTarget.open);}}>
  <summary>{l("检查项目内容","Check project knowledge")}</summary>
  <p>{l("检查已保存的方案、来源、进展与未解决事项，只读，不调用 AI。","Review saved choices, sources, reports and open decisions. Read-only; no AI calls.")}</p>
  {loading?<p role="status">{l("读取项目…","Loading projects…")}</p>:<div className="developer-knowledge-controls"><label>{l("选择项目","Project")}<select aria-label={l("选择检查项目","Project to check")} value={selected} onChange={event=>{setSelected(event.target.value);setResult(undefined);}}>{!sessions.length?<option value="">{l("暂无已保存项目","No saved projects")}</option>:sessions.map(session=><option key={session.id} value={session.id}>{session.title}</option>)}</select></label><button type="button" onClick={run} disabled={!selected}>{l("检查已保存知识","Check saved knowledge")}</button></div>}
  {error?<p role="alert">{error}</p>:null}
  {result?<div className="developer-knowledge-result" role="region" aria-label={l("内容检查结果","Knowledge check results")}><p>{l(`${result.sections} 章 · ${result.claims} 条结论 · ${result.openDecisions} 项未解决`,`${result.sections} chapters · ${result.claims} claims · ${result.openDecisions} open decisions`)}</p>{result.findings.length?<ul>{result.findings.map((finding,index)=><li key={index}><strong>{finding.title}{finding.sectionId?` · ${sessions.find(session=>session.id===selected)?.sections.find(section=>section.id===finding.sectionId)?.title??finding.sectionId}`:""}</strong><p>{finding.action}</p></li>)}</ul>:<p>{l("未发现本地规则能识别的问题；仍需核对真实整理结果。","No issues detected by local rules; review actual generated content separately.")}</p>}</div>:null}
 </details>;
}
