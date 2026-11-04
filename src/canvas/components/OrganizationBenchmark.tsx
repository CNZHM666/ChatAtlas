import {Download,Upload} from "lucide-react";
import {useRef,useState} from "react";
import {summarizeAnalysisCsv,compareBenchmarks,type BenchmarkSummary} from "../../ai/organization-benchmark.mjs";
import {analyzeOrganizationRuns,organizationAnalysisCsv} from "../../ai/usage-analysis";
import {listAIUsage} from "../../storage/ai-usage";
import {listOrganizationRuns} from "../../storage/organization-runs";
import {listFocusSessions} from "../../storage/focus-sessions";
import {listAnalysisDiagnostics} from "../../ai/semantic-analysis";

const download=(text:string,name:string,type:string)=>{const url=URL.createObjectURL(new Blob([text],{type})),link=document.createElement("a");link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),0);};
export function OrganizationBenchmark({zh}:{zh:boolean}) {
 const l=(cn:string,en:string)=>zh?cn:en;
 const [files,setFiles]=useState<Partial<Record<"before"|"after",{name:string;summary:BenchmarkSummary}>>>({}),[errors,setErrors]=useState<Partial<Record<"before"|"after",string>>>({}),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const versions=useRef({before:0,after:0});
 const load=async(key:"before"|"after",file?:File)=>{
  const version=++versions.current[key];setFiles(current=>({...current,[key]:undefined}));setErrors(current=>({...current,[key]:undefined}));if(!file)return;
  try{if(file.size>20_000_000)throw new Error("File too large");const summary=summarizeAnalysisCsv(await file.text());if(versions.current[key]===version)setFiles(current=>({...current,[key]:{name:file.name,summary}}));}
  catch{if(versions.current[key]===version)setErrors(current=>({...current,[key]:l("无法读取，请选择有效的任务分析 CSV（小于 20 MB）。","Select a valid analysis CSV smaller than 20 MB.")}));}
 };
 const exportCurrent=async()=>{
  setBusy(true);setMessage("");
  try{const [runs,events,diagnostics,sessions]=await Promise.all([listOrganizationRuns(),listAIUsage(),listAnalysisDiagnostics(),listFocusSessions()]);const rows=analyzeOrganizationRuns(runs,events,diagnostics,sessions);if(!rows.length){setMessage(l("暂无任务记录，完成一次整理后再导出。","No runs yet. Organize a sample before exporting."));return;}download(organizationAnalysisCsv(rows.slice(0,1)),`ai-organization-analysis-${new Date().toISOString().replace(/[:.]/gu,"-")}.csv`,"text/csv;charset=utf-8");setMessage(l("已导出最近一次任务的指标（含失败记录）。","Exported the latest run, including failures."));}
  catch{setMessage(l("导出失败，请重试。","Export failed. Please retry."));}finally{setBusy(false);}
 };
 const differences=files.before&&files.after?compareBenchmarks(files.before.summary,files.after.summary):undefined;
 const labels:Record<string,string>={runs:l("任务数","Runs"),requests:l("已发送请求","Sent requests"),inputTokens:l("输入 Token","Input tokens"),outputTokens:l("输出 Token","Output tokens"),cachedInputTokens:l("缓存读取 Token","Cached input tokens"),failures:l("失败记录","Failed events"),firstReadableMs:l("首次可读中位数（ms）","Median first readable (ms)"),elapsedMs:l("任务累计耗时（ms）","Summed elapsed (ms)")};
 const value=(n?:number)=>n===undefined?"—":n.toLocaleString(undefined,{maximumFractionDigits:1});
 return <section className="developer-benchmark" aria-label={l("固定样例基准对比","Fixed-sample benchmark")}>
  <div className="developer-benchmark-heading"><strong>{l("固定样例基准对比","Fixed-sample benchmark")}</strong><button type="button" onClick={()=>void exportCurrent()} disabled={busy}><Download size={14} aria-hidden="true"/>{busy?l("导出中…","Exporting…"):l("导出最近任务 CSV","Export latest run CSV")}</button></div>
  <p>{l("使用相同材料、范围与模型，导入两次整理的 CSV 查看差异。","Use the same sources, scope and model. Import both run CSVs to compare.")}</p>
  <div className="developer-benchmark-files">{(["before","after"] as const).map(key=><label className="developer-benchmark-file" key={key}><span>{key==="before"?l("优化前 CSV","Before CSV"):l("优化后 CSV","After CSV")}</span><span className="developer-file-trigger"><Upload size={15} aria-hidden="true"/><span title={files[key]?.name}>{files[key]?.name??l("选择 CSV 文件","Choose CSV file")}</span><input aria-label={key==="before"?l("优化前 CSV","Before CSV"):l("优化后 CSV","After CSV")} type="file" accept=".csv,text/csv" onChange={event=>void load(key,event.target.files?.[0])}/></span>{files[key]?<small>{files[key]!.summary.runs} {l("个任务 · 可重新选择","runs · select to replace")}</small>:null}{errors[key]?<span className="developer-control-error" role="alert">{errors[key]}</span>:null}</label>)}</div>
  {differences?<><div className="developer-stage-table"><table><thead><tr><th>{l("指标","Metric")}</th><th>{l("优化前","Before")}</th><th>{l("优化后","After")}</th><th>{l("变化（后 − 前）","Change (after − before)")}</th></tr></thead><tbody>{differences.map(row=><tr key={row.metric}><td>{labels[row.metric]??row.metric}</td><td>{value(row.before)}</td><td>{value(row.after)}</td><td>{value(row.delta)}{row.percent!==undefined?` (${row.percent>0?"+":""}${row.percent.toFixed(1)}%)`:""}</td></tr>)}</tbody></table></div><p>{l("缺失指标显示 —；旧记录无法推断失败来源。耗时下降不等于质量更好，请另行检查章节、引用和条件。CSV 包含所导出的全部任务，比较前请确认任务数与材料范围一致。","Missing metrics show —; older records may lack failure origins. Lower latency does not establish quality: review chapters, citations and conditions. CSVs include all exported runs; verify equal run counts and sample scope.")}</p><button type="button" onClick={()=>download(JSON.stringify({version:1,before:files.before,after:files.after,differences},null,2),"organization-benchmark-comparison.json","application/json")}>{l("导出对比结果","Export comparison")}</button></>:null}
  {message?<p role="status">{message}</p>:null}
 </section>;
}
