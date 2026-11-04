import { useState } from "react";
import { aiFeatureLabel,usageFeature } from "../../ai/ai-diagnostics";
import type { analyzeAILifecycle } from "../../ai/lifecycle-analysis";
const ms=(value:number|undefined)=>value===undefined?"—":`${(value/1000).toFixed(2)} s`;
const signals={
  queue:["排队占比较高：检查并发、限流与请求优先级。","Queueing is high: inspect concurrency, rate limits and priority."],
  first_token:["首字等待超过 10 秒：对照输入长度、推理 Token 和供应商响应；本机无法直接测量服务端推理。","First token exceeds 10s: compare input size, reasoning and provider response; server inference is not directly measured."],
  validation:["本地校验占比较高：检查重复扫描和校验器。","Local validation is expensive: inspect repeated scans and validators."],
  retry:["存在自动重试：查看同一操作 ID 的失败与后续尝试。","Retries occurred: compare attempts under the same operation ID."],
  output_limit:["输出达到长度上限：检查推理消耗、输出预算和结构过大问题。","Output limit reached: inspect reasoning, output cap and schema size."],
  input:["存在超过 8,000 Token 的输入估算：优先检查重复来源与上下文范围。","Inputs exceed 8,000 tokens: inspect duplicate sources and scope."],
  missing_timing:["部分记录没有完整计时，不能据此补算各阶段耗时。","Some records lack complete timing; phase costs cannot be reconstructed."],
  unclassified:["部分历史调用缺少功能标记；新记录会携带功能与操作分类。","Some legacy calls lack feature labels; new calls carry feature and operation metadata."],
} as const;
export function AIChainDiagnostics({data,zh}:{data:ReturnType<typeof analyzeAILifecycle>;zh:boolean}) {
  const [all,setAll]=useState(false);
  return <details className="developer-analysis-extra"><summary>{zh?"完整 AI 链路与优化线索":"AI lifecycle and optimization signals"}</summary>
    <p>{zh?"按请求开始时间排列。排队、首包、首字、网络接收和校验分别记录；首字时间包含首包等待，不能相加。请求累计时间可能因并发大于墙钟时间。缓存复用不代表新的付费调用。":"Ordered by request start. Queue, headers, first token, response and validation are distinct. First-token includes header wait; do not add them. Parallel request time can exceed wall time. Reuse is not a paid call."}</p>
    <dl className="developer-chain-totals"><div><dt>{zh?"请求墙钟跨度":"Request wall span"}</dt><dd>{ms(data.requestWallMs)}</dd></div><div><dt>{zh?"请求活跃时间（去重叠）":"Active time (union)"}</dt><dd>{data.timedRequests?ms(data.activeMs):"—"}</dd></div><div><dt>{zh?"排队 / 网络接收累计":"Queue / response sum"}</dt><dd>{ms(data.measurements.queue?data.queueMs:undefined)} / {ms(data.measurements.response?data.responseMs:undefined)}</dd></div><div><dt>{zh?"校验 / 重试等待累计":"Validation / backoff sum"}</dt><dd>{ms(data.measurements.validation?data.validationMs:undefined)} / {ms(data.measurements.backoff?data.backoffMs:undefined)}</dd></div></dl>
    {data.findings.length?<ul>{data.findings.map(signal=><li key={signal}>{signals[signal][zh?0:1]}</li>)}</ul>:<p>{zh?"现有计时未触发瓶颈提示；这不代表已经达到最优性能。":"No threshold triggered; this does not certify optimal performance."}</p>}
    <div className="developer-stage-table"><table><thead><tr><th>{zh?"功能 / 环节（按累计耗时）":"Feature / operation (by total time)"}</th><th>{zh?"调用 / 复用 / 失败":"Calls / reused / failed"}</th><th>{zh?"累计 / 排队 / 校验":"Total / queue / validation"}</th><th>{zh?"输入 / 输出":"Input / output"}</th></tr></thead><tbody>{data.stages.map(row=><tr key={`${row.feature}:${row.stage}`}><td>{aiFeatureLabel(row.feature,zh)}<small className="developer-code">{row.stage}</small></td><td>{row.requests} / {row.cached} / {row.failed}</td><td>{ms(row.timed||!row.requests?row.durationMs:undefined)} / {ms(row.queueTimed||!row.requests?row.queueMs:undefined)} / {ms(row.validationTimed||!row.requests?row.validationMs:undefined)}</td><td>{row.input} / {row.output}</td></tr>)}</tbody></table></div>
    <details className="developer-analysis-extra"><summary>{zh?`逐请求时间线 · ${data.events.length}`:`Request timeline · ${data.events.length}`}</summary>{data.events.slice(0,all?undefined:30).map((event,index)=><details className="developer-request-metrics" key={event.id}><summary>{index+1} · {event.operation??event.stage??event.taskType} · {event.status} · {ms(event.durationMs)}</summary><dl>
      <div><dt>{zh?"功能 / 模型":"Feature / model"}</dt><dd>{aiFeatureLabel(usageFeature(event),zh)} · {event.modelId}</dd></div>
      <div><dt>{zh?"操作 ID / 服务商 ID":"Operation / provider request ID"}</dt><dd>{event.operationId??"—"} / {event.requestId??"—"}</dd></div>
      <div><dt>{zh?"开始 / 尝试":"Started / attempt"}</dt><dd>{event.requestStartedAt?new Date(event.requestStartedAt).toLocaleTimeString():"—"} / {event.attempt}</dd></div>
      {event.schedulingMs!==undefined?<div><dt>{zh?"本轮调度至本次请求":"Round scheduling to this request"}</dt><dd>{ms(event.schedulingMs)}</dd></div>:null}
      {event.parentOperationId?<div><dt>{zh?"恢复父操作 / 原因 / 深度":"Recovery parent / reason / depth"}</dt><dd>{event.parentOperationId} / {event.recoveryReason??"—"} / {event.recoveryDepth??"—"}</dd></div>:null}
      <div><dt>{zh?"重试前等待":"Backoff before attempt"}</dt><dd>{ms(event.timing?.backoffMs)}</dd></div>
      <div><dt>{zh?"准备 / 查缓存 / 写缓存":"Preparation / cache lookup / write"}</dt><dd>{ms(event.timing?.preparationMs)} / {ms(event.timing?.cacheLookupMs)} / {ms(event.timing?.cacheWriteMs)}</dd></div>
      <div><dt>{zh?"排队 / 首包 / 首字":"Queue / headers / first token"}</dt><dd>{ms(event.timing?.queueMs??event.queueMs)} / {ms(event.responseHeadersMs)} / {ms(event.firstTokenMs)}</dd></div>
      <div><dt>{zh?"网络接收 / 本地校验 / 其他客户端处理":"Response / validation / other client work"}</dt><dd>{ms(event.timing?.responseMs??event.responseMs)} / {ms(event.timing?.validationMs)} / {ms(event.timing?.clientMs)}</dd></div>
      <div><dt>{zh?"输入 / 输出 / 来源":"Input / output / source"}</dt><dd>{event.inputTokens} / {event.outputTokens} / {event.tokenSource}</dd></div>
      <div><dt>{zh?"缓存层 / 失败 / 超时":"Cache layer / error / timeout"}</dt><dd>{event.cacheLayer??"—"} / {event.errorCode??"—"} / {event.timeoutStage??"—"}</dd></div>
    </dl></details>)}{data.events.length>30?<button type="button" onClick={()=>setAll(value=>!value)}>{zh?all?"收起请求":"显示全部请求":all?"Show fewer":"Show all requests"}</button>:null}</details>
  </details>;
}
