import {OrganizationBenchmark} from "./OrganizationBenchmark";
import {DeveloperKnowledgeUnits} from "./DeveloperKnowledgeUnits";
import {lazy,Suspense,useState} from "react";
import {ChevronDown,Download,Play} from "lucide-react";
import {runAIChainLocalChecks} from "../ai-chain-local-checks";
import {runKnowledgeLocalChecks} from "../knowledge-local-checks";
import {runProjectLocalChecks,type ProjectLocalCheck} from "../project-local-checks";
import {projectTestCases,projectTestPhases,projectTestPlanMarkdown,projectTestPlanVersion,projectTestSample,type ProjectTestArea,type ProjectTestPhase} from "../project-test-plan";
import {DeveloperKnowledgeCheck} from "./DeveloperKnowledgeCheck";
import type {knowledgeCheckExport} from "../project-knowledge-checks";

const WorkspaceLayoutExample=lazy(()=>import("./WorkspaceLayoutExample").then(module=>({default:module.WorkspaceLayoutExample})));
const storageKey="atlas-project-test-report-v1";
type Result="untested"|"passed"|"failed"|"blocked";
interface TestRecord {version:1;planVersion:string;sample:string;model:string;scope:string;cases:Record<string,{result:Result;note:string;updatedAt:number}>;local?:{at:number;checks:ProjectLocalCheck[]}}
const empty=():TestRecord=>({version:1,planVersion:projectTestPlanVersion,sample:"",model:"",scope:"",cases:{}});
function load():TestRecord {
 try{
  const data=JSON.parse(localStorage.getItem(storageKey)??"null") as TestRecord|null;
  if(data?.version!==1||typeof data.planVersion!=="string"||![data.sample,data.model,data.scope].every(value=>typeof value==="string")||!data.cases||typeof data.cases!=="object"||Array.isArray(data.cases))return empty();
  const cases=Object.fromEntries(Object.entries(data.cases).filter(([,value])=>value&&["untested","passed","failed","blocked"].includes(value.result)&&typeof value.note==="string"));
  const local=data.local&&Array.isArray(data.local.checks)&&data.local.checks.every(check=>typeof check.id==="string"&&typeof check.passed==="boolean"&&Number.isFinite(check.durationMs))?data.local:undefined;
  return {...data,cases,local};
 }catch{return empty();}
}
function download(text:string,name:string,type:string){const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement("a");link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),0);}

export function DeveloperProjectTests({zh,embedded=false}:{zh:boolean;embedded?:boolean}){
 const [exampleOpen,setExampleOpen]=useState(false),[record,setRecord]=useState(load),[area,setArea]=useState<ProjectTestArea|"all">("all"),[phase,setPhase]=useState<ProjectTestPhase|"all">("all"),[query,setQuery]=useState(""),[failedOnly,setFailedOnly]=useState(false),[message,setMessage]=useState("");
 const [knowledge,setKnowledge]=useState<ReturnType<typeof knowledgeCheckExport>>();
 const t=(value:readonly[string,string])=>value[zh?0:1],l=(cn:string,en:string)=>zh?cn:en;
 const save=(next:TestRecord,notify=false)=>{setRecord(next);try{localStorage.setItem(storageKey,JSON.stringify(next));if(notify)setMessage(l("测试记录已保存在本机","Test record saved locally"));}catch{setMessage(l("本机存储失败，记录仍可导出","Local storage failed; records can still be exported"));}};
 const run=()=>save({...record,local:{at:Date.now(),checks:[...runKnowledgeLocalChecks(zh),...runProjectLocalChecks(),...runAIChainLocalChecks()]}},true);
 const visible=projectTestCases.filter(item=>(area==="all"||item.area===area||item.area==="shared")&&(phase==="all"||item.phase===phase)&&(!failedOnly||record.cases[item.id]?.result==="failed")&&(!query.trim()||`${item.id} ${t(item.title)} ${t(item.setup)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
 const tested=projectTestCases.filter(item=>record.cases[item.id]?.result&&record.cases[item.id].result!=="untested").length;
 const checks=record.local?.checks??[],failed=checks.filter(check=>!check.passed);
 const cost={local:l("本地，无模型调用","Local, no model calls"),ai:l("需主动生成，消耗 Token","Explicit generation, uses tokens"),mixed:l("本地与 AI 分别核对","Separate local and AI checks")};
 const Container=embedded?"div":"details";
 const exportReport=()=>download(JSON.stringify({...record,exportedAt:new Date().toISOString(),planVersion:projectTestPlanVersion,previousPlanVersion:record.planVersion,knowledge,plan:projectTestCases},null,2),"chatatlas-test-report.json","application/json");
 return <Container className="developer-project-tests">
  {embedded?null:<summary><span>{l("开发者测试","Developer tests")}</span><ChevronDown size={16} aria-hidden="true"/></summary>}
  <div className="developer-project-test-body">
   <div className="developer-test-start"><div className="developer-test-section-heading"><strong>{l("快速检查","Quick checks")}</strong><button type="button" className="primary" onClick={run}><Play size={14} aria-hidden="true"/>{l("运行本地回归","Run local checks")}</button></div><p>{l("检查本地知识与 AI 链路规则，不调用模型、不修改项目。","Check local knowledge and AI pipeline rules, without model calls or project changes.")}</p></div>
   <div className="developer-test-tools"><button type="button" onClick={()=>setExampleOpen(true)}>{l("打开示例项目","Open example project")}</button><details className="developer-export-menu"><summary><Download size={14} aria-hidden="true"/>{l("导出","Export")}</summary><div><button type="button" onClick={exportReport}>{l("导出测试报告","Export test report")}</button><button type="button" onClick={()=>download(projectTestPlanMarkdown(zh),"chatatlas-test-plan.md","text/markdown;charset=utf-8")}>{l("导出测试方案","Export test plan")}</button></div></details></div>
   {record.local?<section className="developer-check-result" aria-label={l("最近本地回归","Latest local checks")}><strong>{failed.length?l(`${failed.length} 项未通过`,`${failed.length} checks failed`):l(`${checks.length} 项本地检查通过`,`${checks.length} local checks passed`)}</strong><small>{new Date(record.local.at).toLocaleString()} · {checks.length-failed.length}/{checks.length}</small><p>{l("仅验证本地规则；真实模型输出和界面体验需分别核对。","Local rules only; evaluate actual model output and the interface separately.")}</p>{failed.length?<ul className="developer-local-checks">{failed.map(check=><li key={check.id}><strong>{check.title}</strong><p>{check.detail}</p></li>)}</ul>:null}<details><summary>{l("查看全部检查","View all checks")}</summary><ul className="developer-local-checks">{checks.map(check=><li key={check.id}><strong>{check.passed?l("通过","Pass"):l("失败","Fail")}</strong><span>{check.title}</span><small>{check.durationMs.toFixed(2)} ms</small><details><summary>{l("技术详情","Technical details")}</summary><p>{check.id} · {check.detail}</p></details></li>)}</ul></details></section>:null}
   <DeveloperKnowledgeUnits zh={zh}/>
   <details><summary>{l("运行指标对比（CSV）","Run metrics comparison (CSV)")}</summary><OrganizationBenchmark zh={zh}/></details>
   <details><summary>{l("知识证据核对","Knowledge evidence checks")}</summary><DeveloperKnowledgeCheck zh={zh} onResult={setKnowledge}/></details>
   <details className="developer-manual-plan"><summary>{l("人工测试方案","Manual test plan")}<small>{tested}/{projectTestCases.length}</small></summary>
    <p>{l("在独立测试项目操作，记录真实模型的结果与差异。本地通过不会自动勾选这些结果。","Use a separate test project and record actual model results. Local success never marks these tests passed.")}</p>
    <details className="developer-analysis-extra"><summary>{l("样本与运行信息","Sample and run information")}</summary><div className="developer-project-test-context">{(["sample","model","scope"] as const).map(field=><label key={field}>{field==="sample"?l("样本名称","Sample"):field==="model"?l("测试模型","Model"):l("材料范围与大小","Scope and size")}<input value={record[field]} maxLength={160} onChange={event=>save({...record,[field]:event.target.value})}/></label>)}</div><details><summary>{l("查看固定测试材料","Fixed test material")}</summary><pre>{projectTestSample}</pre></details></details>
    <div className="developer-project-test-filters"><label>{l("测试对象","Test area")}<select aria-label={l("测试对象","Test area")} value={area} onChange={event=>setArea(event.target.value as typeof area)}><option value="all">{l("全部","All")}</option><option value="ai">{l("所有 AI 链路","All AI pipelines")}</option><option value="architecture">{l("架构图与共用流程","Architecture and shared flow")}</option><option value="versions">{l("产品版本与共用流程","Releases and shared flow")}</option></select></label><label>{l("测试阶段","Test phase")}<select aria-label={l("测试阶段","Test phase")} value={phase} onChange={event=>setPhase(event.target.value as typeof phase)}><option value="all">{l("全部阶段","All phases")}</option>{Object.entries(projectTestPhases).map(([key,value])=><option key={key} value={key}>{t(value)}</option>)}</select></label></div>
    <button type="button" onClick={()=>{setArea("all");setPhase("all");setQuery("");setFailedOnly(false);}}>{l("重置筛选","Reset filters")}</button>
    <div className="developer-test-search"><input type="search" aria-label={l("查找测试项","Find a test")} placeholder={l("按名称或编号查找","Search by name or ID")} value={query} onChange={event=>setQuery(event.target.value)}/><label><input type="checkbox" checked={failedOnly} onChange={event=>setFailedOnly(event.target.checked)}/>{l("只看失败","Failed only")}</label></div>
    <p>{l(`方案 ${projectTestPlanVersion} · 已记录 ${tested}/${projectTestCases.length} 项`,`Plan ${projectTestPlanVersion} · ${tested}/${projectTestCases.length} recorded`)}</p>
    {visible.map(item=><details className="developer-project-test-case" key={item.id}><summary><span>{item.id} · {t(item.title)}<small>{t(projectTestPhases[item.phase])} · {cost[item.cost]}</small></span><small>{record.cases[item.id]?.result==="passed"?l("通过","Passed"):record.cases[item.id]?.result==="failed"?l("失败","Failed"):record.cases[item.id]?.result==="blocked"?l("待条件具备","Blocked"):l("未测试","Untested")}</small></summary><p><strong>{l("前置条件：","Setup: ")}</strong>{t(item.setup)}</p><ol>{item.steps.map((step,index)=><li key={index}>{t(step)}</li>)}</ol><ul>{item.expected.map((expected,index)=><li key={index}>{l("预期：","Expected: ")}{t(expected)}</li>)}</ul><label>{l("人工测试结果","Manual result")}<select aria-label={l("人工测试结果","Manual result")} value={record.cases[item.id]?.result??"untested"} onChange={event=>save({...record,cases:{...record.cases,[item.id]:{result:event.target.value as Result,note:record.cases[item.id]?.note??"",updatedAt:Date.now()}}})}><option value="untested">{l("未测试","Untested")}</option><option value="passed">{l("通过","Passed")}</option><option value="failed">{l("失败","Failed")}</option><option value="blocked">{l("待条件具备","Blocked")}</option></select></label><label>{l("任务 ID、指标与差异备注","Run ID, measurements and differences")}<textarea value={record.cases[item.id]?.note??""} maxLength={2000} rows={3} onChange={event=>save({...record,cases:{...record.cases,[item.id]:{result:record.cases[item.id]?.result??"untested",note:event.target.value,updatedAt:Date.now()}}})}/></label></details>)}
    {!visible.length?<p>{l("没有匹配的测试项。","No matching tests.")}</p>:null}
   </details>
   {exampleOpen?<Suspense fallback={<p role="status">{l("加载示例…","Loading example…")}</p>}><WorkspaceLayoutExample overlay zh={zh} onClose={()=>setExampleOpen(false)}/></Suspense>:null}
   {message?<p role="status">{message}</p>:null}
  </div>
 </Container>;
}
