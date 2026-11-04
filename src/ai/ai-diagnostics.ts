import type { AIUsageEvent, AITaskType } from "../shared/types";

export const aiFeatures = {
  evolution:["项目演进","Project evolution"], releases:["历史版本分析（已停用）","Legacy version analysis (retired)"],
  wiki:["总览与 Wiki","Overview and Wiki"], project_state:["项目事项与架构","Project records and architecture"],
  project_query:["项目问答","Project questions"], history_search:["历史查找","History search"],
  conversation:["对话整理","Conversation organization"], knowledge:["知识整理","Knowledge organization"],
  embedding:["语义向量","Embeddings"], source_retrieval:["来源推荐","Source retrieval"],
  context:["上下文整理","Context handoff"],
  connection:["连接测试","Connection test"], unclassified:["未标注的历史请求","Unlabelled legacy request"],
} as const;
export type AIFeature = keyof typeof aiFeatures;
export interface AITrace { feature?: AIFeature; operation?: string; operationId?:string; parentOperationId?: string; recoveryReason?:"output_truncation"|"schema"|"transport"; recoveryDepth?:number; schedulingMs?:number }
export interface AITiming {
  preparationMs?: number; cacheLookupMs?: number; cacheWriteMs?:number; validationMs?: number;
  queueMs?: number; responseMs?: number; backoffMs?: number;
  /** Client processing outside queue/network/validation; not provider inference time. */
  clientMs?: number;
}
const safeCode=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9_.:/-]{1,100}$/u.test(value)?value:undefined;

/** Diagnostic metadata never changes prompts, policy routing, cache identity or billing. */
export function classifyAIRequest(task:AITaskType="other", prompt?:string, trace?:AITrace) {
  let data:Record<string,unknown>={};try{data=JSON.parse(prompt??"{}");}catch{/* non-JSON tasks retain task identity */}
  const presentation=safeCode(data.presentation),stage=safeCode(data.stage),coverage=data.coverage as {stage?:unknown;final?:boolean}|undefined;
  let feature:AIFeature=trace?.feature??"unclassified";
  if(!trace?.feature){
    if(stage?.startsWith("evolution:"))feature="evolution";
    else if(presentation==="product_history")feature=data.analysisKind==="releases"?"releases":"evolution";
    else if(presentation?.startsWith("wiki_"))feature="wiki";
    else if(presentation==="knowledge_lint")feature="knowledge";
    else if(presentation==="sidecar_context")feature="context";
    else if(presentation==="project_state"||presentation==="semantic_structure"||presentation==="structure_review")feature="project_state";
    else if(presentation==="project_query"||task==="project_query_plan")feature="project_query";
    else if(presentation?.startsWith("home_")||presentation?.startsWith("history_discovery"))feature="history_search";
    else if(task==="focus_session")feature="wiki";
    else if(task==="embedding")feature="embedding";
    else if(task==="source_retrieval")feature="source_retrieval";
    else if(["question_snapshot","conversation_profile","conversation_structure","chapter_planning"].includes(task))feature="conversation";
    else if(["knowledge_planning","global_merge","insight_judge","relation_judge","composition_judge"].includes(task))feature="knowledge";
  }
  const covered=safeCode(coverage?.stage);
  const operation=safeCode(trace?.operation)??([presentation,covered?`${covered}${coverage?.final?":final":""}`:stage].filter(Boolean).join(":")||task);
  return {feature,operation};
}
export function usageFeature(event:Pick<AIUsageEvent,"feature"|"taskType"|"stage">):AIFeature {
  if(event.feature&&event.feature in aiFeatures)return event.feature;
  if(event.stage?.startsWith("evolution:"))return "evolution";
  const [presentation,...rest]=(event.stage??"").split(":");
  return classifyAIRequest(event.taskType,JSON.stringify({presentation,stage:rest.join(":")})).feature;
}
export function aiFeatureLabel(feature:AIFeature,zh:boolean){return aiFeatures[feature][zh?0:1];}
export function aiUsageLabel(event:Pick<AIUsageEvent,"feature"|"taskType"|"stage">,zh:boolean){return aiFeatureLabel(usageFeature(event),zh);}
