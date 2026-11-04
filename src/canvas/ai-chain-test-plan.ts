import type { ProjectTestCase } from "./project-test-plan";
const pipelines = [
 ["总览与 Wiki 生成、目录及局部整理","Overview and Wiki"],
 ["项目演进提取、核验、匹配与续接","Evolution extraction, verification, matching and continuation"],
 ["项目事项及架构（已有能力）","Project records and existing architecture analysis"],
 ["项目问答规划与回答","Project question planning and answers"],
 ["历史查找与来源推荐","History search and source recommendations"],
 ["对话画像、章节和知识整理","Conversation profiles, chapters and knowledge"],
 ["语义向量建立与查询","Embedding indexing and queries"],
 ["侧栏上下文整理与本地项目上下文","Sidecar context and local project context"]
];
export const aiChainTestCases:ProjectTestCase[]=[
 ...pipelines.map(([name,english],index):ProjectTestCase=>({
  // Retiring the third pipeline must not renumber existing manual test results.
  id:`AI:chain:${index+1+(index>=2?1:0)}`,area:"ai",phase:"performance",title:[`${name}链路`,`${english} pipeline`],
  setup:["在独立测试项目中配置已有 API，记录模型、来源范围和本次任务 ID；不使用正式项目测试破坏性操作。","Use an isolated project and existing API; record model, scope and run ID."],
  steps:[
   ["主动执行对应功能一次，刷新开发者分析，按功能筛选并展开完整 AI 链路。本地项目上下文组装应无模型请求。","Trigger the feature, refresh diagnostics, filter and inspect the lifecycle. Local project context assembly must make no model calls."],
   ["记录每阶段请求、准备、排队、首字、接收、校验、Token 来源；再次执行相同操作，再只增加一条讨论。","Measure stages, preparation, queue, first token, response, validation and token source; repeat unchanged, then add one discussion."]
  ],
  expected:[
   ["功能与阶段可辨识，不再只显示其他；每次真实请求、失败与复用可区分；没有计时的环节显示未知。","Feature and operation are identifiable; paid calls, failures and reuse are distinct; missing timing stays unknown."],
   ["相同结果复用不重复计费；增量分析保留原文与个人编辑；质量、召回与成本需同时记录，不能只比速度。","Reuse is not rebilled; incremental analysis preserves sources and edits; measure quality and recall alongside cost."]
  ],cost:"mixed"
 })),
 {id:"AI:evidence-navigation",area:"ai",phase:"verify",title:["章节依据范围、去重与定位","Chapter evidence scope, deduplication and positioning"],setup:["两个章节引用同一消息的不同片段，另有长回答与旧来源版本。","Use two chapters sharing different excerpts, a long reply and retained source versions."],steps:[["逐章打开依据、连续切换消息、展开完整上下文并手动滚动。","Open each chapter’s evidence, switch messages, expand context and scroll manually."]],expected:[["仅当前章节的依据和高亮；同一消息同版本去重，不合并不同版本；切换不清空正文，问题上方留白，手动滚动不被拉回；无模型调用。","Only this chapter’s sources and highlights; deduplicate identical message versions; preserve content and question spacing; no scroll fighting or model calls."]],cost:"local"},
 {id:"AI:recovery",area:"ai",phase:"recover",title:["所有 AI 的失败、限流与取消诊断","Failure, rate-limit and cancellation diagnostics"],setup:["独立测试连接；保留已成功输出。","Use an isolated connection; retain successful outputs."],steps:[["用测试供应商模拟 429、无效 JSON、截断、无 usage、取消和网络中断，检查同一操作 ID 的尝试记录。","Simulate 429, invalid JSON, truncation, missing usage, cancellation and disconnect; inspect operation attempts."]],expected:[["失败不伪造零成本或成功；重试等待与排队区分；取消后可保留已完成检查点，不自动重放全部内容。","Failures do not claim free/success; backoff differs from queueing; cancellation retains completed checkpoints without replaying all work."]],cost:"mixed"},
 {id:"AI:export",area:"ai",phase:"verify",title:["诊断导出与隐私","Diagnostic export privacy"],setup:["存在多功能调用、缓存及旧日志。","Have multiple features, cache receipts and legacy logs."],steps:[["按功能筛选，导出 CSV 和逐请求 JSON，核对界面与文件。","Filter feature, export CSV and request JSON, compare with UI."]],expected:[["不含 Prompt、正文、API Key、对话标题或备注；未知值保持未知；模型用量与估算明确区分。","No prompts, source content, API keys, titles or notes; unknowns remain unknown and reported tokens differ from estimates."]],cost:"local"}
];
