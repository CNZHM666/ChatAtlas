import "../usage-developer.css";
import {isSentUsage} from "../../ai/failure-origin";
import {useEffect,useId,useState} from "react";
import {aiFeatureLabel,usageFeature,type AIFeature} from "../../ai/ai-diagnostics";
import type {AIUsageEvent} from "../../shared/types";
import {listAIUsage} from "../../storage/ai-usage";
import {listConversations} from "../../storage/conversations";
import {DeveloperAnalysis} from "./DeveloperAnalysis";
import {DeveloperProjectTests} from "./DeveloperProjectTests";

type Period="all"|"30"|"7";
type Dimension="feature"|"model"|"conversation";
const DAY=86_400_000;

export function UsageLedger({locale}:{locale:string}){
 const zh=locale!=="en",l=(cn:string,en:string)=>zh?cn:en,id=useId();
 const [events,setEvents]=useState<AIUsageEvent[]>([]),[names,setNames]=useState<Record<string,string>>({});
 const [view,setView]=useState<"usage"|"diagnostics"|"tests">("usage"),[visited,setVisited]=useState({diagnostics:false,tests:false});
 const [dimension,setDimension]=useState<Dimension>("feature"),[expanded,setExpanded]=useState(false),[period,setPeriod]=useState<Period>("all");
 const [loadError,setLoadError]=useState(false);
 useEffect(()=>{let active=true;void Promise.all([listAIUsage(),listConversations()]).then(([usage,conversations])=>{if(active){setEvents(usage);setNames(Object.fromEntries(conversations.map(item=>[item.id,item.title])));}}).catch(()=>{if(active)setLoadError(true);});return()=>{active=false;};},[]);
 const since=period==="all"?-Infinity:Date.now()-Number(period)*DAY,scoped=events.filter(item=>item.createdAt>=since);
 const provider=scoped.filter(item=>item.tokenSource==="provider"),estimated=scoped.filter(item=>item.tokenSource==="estimated"),unavailable=scoped.filter(item=>item.tokenSource==="unavailable");
 const counted=[...provider,...estimated],input=counted.reduce((sum,item)=>sum+item.inputTokens,0),output=counted.reduce((sum,item)=>sum+item.outputTokens,0),embedding=counted.reduce((sum,item)=>sum+(item.embeddingTokens??0),0);
 // Provider prompt-cache reads are part of input; unknown when no provider reported them.
 const cacheReported=scoped.some(item=>item.cachedInputTokens!==undefined),cachedInput=scoped.reduce((sum,item)=>sum+(item.cachedInputTokens??0),0);
 const paid=scoped.filter(isSentUsage),reused=scoped.filter(item=>item.status==="cached").length,priced=paid.filter(item=>item.costCny!==undefined),cost=priced.reduce((sum,item)=>sum+(item.costCny??0),0),pending=scoped.reduce((sum,item)=>sum+(item.pendingCostCny??0),0);
 const groups=new Map<string,number>();
 for(const event of scoped){const key=dimension==="feature"?usageFeature(event):dimension==="model"?event.modelId:event.conversationIds.length===1?event.conversationIds[0]:"__shared__";groups.set(key,(groups.get(key)??0)+event.inputTokens+event.outputTokens+(event.embeddingTokens??0));}
 const rows=[...groups].filter(([,tokens])=>tokens>0||dimension!=="model").sort((a,b)=>b[1]-a[1]),visible=expanded?rows:rows.slice(0,6),largest=rows[0]?.[1]||1;
 const rowLabel=(key:string)=>dimension==="feature"?aiFeatureLabel(key as AIFeature,zh):dimension==="model"?key:key==="__shared__"?l("跨对话任务","Across conversations"):names[key]??key;
 return <div className="ai-usage-ledger">
  <nav className="ai-usage-views" aria-label={l("使用记录视图","Usage views")}>{(["usage","diagnostics","tests"] as const).map(key=><button type="button" key={key} aria-pressed={view===key} aria-controls={`${id}-${key}`} onClick={()=>{setView(key);if(key!=="usage")setVisited(current=>({...current,[key]:true}));}}>{key==="usage"?l("用量概览","Usage"):key==="diagnostics"?l("任务诊断","Diagnostics"):l("开发者测试","Developer tests")}</button>)}</nav>
  <div id={`${id}-usage`} className="ai-usage-view" hidden={view!=="usage"} role="region" aria-label={l("用量概览","Usage")}>
   <div className="ai-usage-filters" role="group" aria-label={l("时间范围","Time range")}>{(["all","30","7"] as const).map(key=><button type="button" key={key} aria-pressed={period===key} onClick={()=>{setPeriod(key);setExpanded(false);}}>{key==="all"?l("全部","All"):key==="30"?l("近 30 天","30 days"):l("近 7 天","7 days")}</button>)}</div>
   <div className="ai-usage-heading"><div><small>{l("累计 Token","Total tokens")}</small><strong>{(input+output+embedding).toLocaleString()}</strong></div><span>{l(`${paid.length} 次请求 · ${reused} 次复用`,`${paid.length} requests · ${reused} reused`)}</span></div>
   {loadError?<p role="alert">{l("使用记录读取失败，请重新打开。","Could not read usage. Reopen this panel.")}</p>:scoped.length?<>
    <dl className="ai-usage-token-detail"><div><dt>{l("输入","Input")}</dt><dd>{input.toLocaleString()}</dd></div><div><dt>{l("输出","Output")}</dt><dd>{output.toLocaleString()}</dd></div>{cacheReported?<div><dt>{l("缓存读取","Cache reads")}</dt><dd title={l("服务商回报的提示词缓存读取，已计入输入","Provider-reported prompt-cache reads, included in input")}>{cachedInput.toLocaleString()}{input>0?<small> · {Math.round(cachedInput/input*100)}%</small>:null}</dd></div>:null}{embedding>0?<div><dt>Embedding</dt><dd>{embedding.toLocaleString()}</dd></div>:null}</dl>
    {estimated.length>0?<p className="ai-usage-footnote">{l(`其中 ${estimated.reduce((sum,item)=>sum+item.inputTokens+item.outputTokens+(item.embeddingTokens??0),0).toLocaleString()} Token 为本地估算`,`${estimated.reduce((sum,item)=>sum+item.inputTokens+item.outputTokens+(item.embeddingTokens??0),0).toLocaleString()} tokens are locally estimated`)}</p>:null}
    <div className="ai-usage-cost"><span>{priced.length?l("已计价费用","Priced usage"):l("费用未计价","Cost unavailable")}</span>{priced.length?<strong>¥{cost.toFixed(4)}</strong>:null}{priced.length&&priced.length<paid.length?<small>{l("部分请求未计价","Some requests unpriced")}</small>:null}{pending>0?<small>{l("待核实","Pending")} ¥{pending.toFixed(4)}</small>:null}</div>
    {unavailable.length>0?<p className="ai-usage-notice">{l(`${unavailable.length} 次未返回用量，合计可能偏低。`,`${unavailable.length} requests have no usage data; totals may be low.`)}</p>:null}
    <div className="ai-usage-dimensions">{(["feature","model","conversation"] as const).map(key=><button type="button" key={key} aria-pressed={dimension===key} onClick={()=>{setDimension(key);setExpanded(false);}}>{key==="feature"?l("按功能","By feature"):key==="model"?l("按模型","By model"):l("按对话","By conversation")}</button>)}</div>
    <div className="ai-usage-list">{visible.map(([key,tokens])=><div key={key}><span title={rowLabel(key)}>{rowLabel(key)}</span><i className="ai-usage-bar" aria-hidden="true"><i style={{width:`${Math.max(3,Math.round(tokens/largest*100))}%`}}/></i><strong>{tokens.toLocaleString()}</strong></div>)}</div>
    {rows.length>6?<button type="button" className="ai-usage-more" onClick={()=>setExpanded(!expanded)}>{expanded?l("收起","Show less"):l(`查看全部 ${rows.length} 项`,`Show all ${rows.length}`)}</button>:null}
    <p className="ai-usage-footnote">{l("本机记录 · 费用以服务商账单为准","Local records · provider bills determine final cost")}</p>
   </>:<p className="ai-usage-empty">{period==="all"?l("暂无 AI 使用记录。","No AI usage recorded yet."):l("这段时间没有 AI 使用记录。","No AI usage in this period.")}</p>}
  </div>
  {visited.diagnostics?<div id={`${id}-diagnostics`} className="ai-usage-view" hidden={view!=="diagnostics"} role="region" aria-label={l("任务诊断","Diagnostics")}><DeveloperAnalysis locale={locale}/></div>:null}
  {visited.tests?<div id={`${id}-tests`} className="ai-usage-view" hidden={view!=="tests"} role="region" aria-label={l("开发者测试","Developer tests")}><DeveloperProjectTests zh={zh} embedded/></div>:null}
 </div>;
}
