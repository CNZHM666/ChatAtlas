import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSession} from "../shared/focus-session";
import {projectKnowledgeView,projectKnowledgeSection} from "../shared/project-knowledge-view";
import {projectOverviewContent} from "./project-overview";
import {currentMatterSettlement} from "../shared/project-matter-assessment";
import {factTextKey} from "../shared/project-fact-state";

export interface KnowledgeFinding {kind:"conflict"|"source"|"scope"|"delivery"|"settlement"|"duplicate"|"overview";sectionId?:string;title:string;action:string}
export interface ProjectKnowledgeCheck {
 version:1;at:number;sections:number;claims:number;openDecisions:number;reported:number;
 findings:KnowledgeFinding[];
}
/** Read-only signals from saved knowledge. No model, imported messages, database
 * writes or claims that this proves the project has been implemented. */
export function checkProjectKnowledge(session:FocusSession,zh=true):ProjectKnowledgeCheck {
 const view=projectKnowledgeView(session),findings:KnowledgeFinding[]=[],seen=new Map<string,string>();
 const l=(cn:string,en:string)=>zh?cn:en;
 for(const conflict of view.conflicts)findings.push({kind:"conflict",sectionId:conflict.facts[0].sectionId,title:l("有方案记录尚未统一","Some choices remain unreconciled"),action:l("对照适用版本与原文，判断是补充、并存还是替代。","Compare scope and originals: supplement, coexistence or replacement?")});
 for(const fact of view.facts){
  if(fact.sourceChanged)findings.push({kind:"source",sectionId:fact.sectionId,title:l("结论的来源已变化","A claim’s source changed"),action:l("打开本章依据，核对原文后再采用更新。","Review this chapter’s originals before accepting an update.")});
  if(fact.scopeConflict)findings.push({kind:"scope",sectionId:fact.sectionId,title:l("版本标签与原文不一致","Version metadata disagrees with the original"),action:l("核对结论适用的版本，不要合并不同阶段。","Check the applicable version; keep separate phases distinct.")});
 }
 for(const page of session.sections){
  if(page.origin||page.userEdited)continue;
  const displayed=projectKnowledgeSection(page,session,view).body;
  if(/完成情况尚未确认|（未核实）|completion is unconfirmed|(unverified)|讨论称已完成/iu.test(displayed))findings.push({kind:"delivery",sectionId:page.id,title:l("完成描述仍缺少直接报告","A completion description lacks a direct report"),action:l("区分建议、用户报告和实际验证；无法确认时保留未知。","Separate proposals, user reports and actual verification; leave unknowns explicit.")});
  for(const node of unified().use(remarkParse).parse(displayed).children){
   if(node.type!=="paragraph")continue;
   const text=displayed.slice(node.position!.start.offset!,node.position!.end.offset!);if(text.length<80)continue;
   const key=factTextKey(text),owner=seen.get(key);
   if(owner&&owner!==page.id)findings.push({kind:"duplicate",sectionId:page.id,title:l("有跨章节重复段落","A paragraph repeats across chapters"),action:l("检查是否应由一个章节解释，其他章节保留必要关联。","Consider one owning explanation with necessary links elsewhere.")});
   else seen.set(key,page.id);
  }
 }
 for(const record of session.projectState?.questions??[]){
  if(record.matter?.settlement&&!currentMatterSettlement(session,record))findings.push({kind:"settlement",title:l("已有解决记录需要重新核对","A saved resolution needs review"),action:l("核对回答是否解决同一对象、同一版本的问题，并检查来源。","Check the same subject, version and valid answer sources.")});
 }
 if(!projectOverviewContent(session).text.trim())findings.push({kind:"overview",title:l("缺少可用的项目概况","No usable project overview"),action:l("补充定位与用户怎样获得结果；复用已有材料，不推断进度。","Describe the purpose and user outcome from saved material without inferring progress.")});
 const unique=[...new Map(findings.map(finding=>[JSON.stringify([finding.kind,finding.sectionId]),finding])).values()];
 return {version:1,at:Date.now(),sections:session.sections.length,claims:view.facts.length,openDecisions:view.questions.length,reported:view.facts.filter(fact=>fact.implementation==="reported"&&!fact.historical&&!fact.sourceChanged).length,findings:unique};
}

/** Only structural signals are exported, never article bodies or source quotes. */
export function knowledgeCheckExport(result:ProjectKnowledgeCheck){return {version:result.version,at:result.at,sections:result.sections,claims:result.claims,openDecisions:result.openDecisions,reported:result.reported,findings:result.findings.map(finding=>({kind:finding.kind,sectionId:finding.sectionId,title:finding.title,action:finding.action}))};}
