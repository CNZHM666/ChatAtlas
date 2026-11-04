import type {FocusSession} from "./focus-session";
import {factTextKey} from "./project-fact-state";
import {discussionBlocks} from "./discussion-context";
import {evidencePresentation} from "./evidence-presentation";
import {projectKnowledgeView,projectKnowledgeIntroduction,knowledgeFactText,projectKnowledgeSection} from "./project-knowledge-view";

export interface ProjectSnapshotBlock {
 role:"scope"|"workflow"|"architecture"|"decision"|"constraint"|"status"|"questions";
 text:string;evidenceIds:string[];sectionIds:string[];
 status:"draft"|"confirmed"|"proposal"|"planned"|"reported"|"background";
}
export const snapshotLabels={scope:["项目介绍","About the project"],workflow:["如何运作","How it works"],architecture:["如何实现","How it is built"],decision:["采用的方案","Chosen approaches"],constraint:["需要注意","Things to keep in mind"],status:["目前进展","Where things stand"],questions:["尚未解决","Still open"]} as const;
export const snapshotStatuses={draft:["整理记录，待核对","Generated record, unreviewed"],confirmed:["已选择方案，实施状态另行判断","Chosen approach, delivery tracked separately"],proposal:["建议，未确认采纳","Proposal, adoption unconfirmed"],planned:["计划，不代表已实现","Planned, implementation unverified"],reported:["用户报告，未核验代码","User reported, code not audited"],background:["来源知识，不证明实施状态","Source knowledge, implementation unverified"]} as const;

/** Old workflow tags can describe a stack rather than a process. Change only
 * the reading label; never infer steps or adoption from technology names. */
function workflowRole(text:string,fallback=false):"workflow"|"architecture" {
 const process=/→|先[\s\S]{0,120}(?:再|然后)|从[\s\S]{0,120}(?:转为|生成|转换)|经[\s\S]{0,80}(?:转为|生成|处理)|输入[\s\S]{0,160}(?:输出|生成|确认)|\b(?:then|followed by|converted into|input[\s\S]{0,100}output)\b/iu.test(text);
 const stack=/技术栈|组件库|UI层|界面风格|设计语言|\b(?:Next\.?js|Tailwind|shadcn|tech(?:nology)? stack|component library)\b/iu.test(text);
 return !process&&(fallback||stack)?"architecture":"workflow";
}

/** Detailed enough to orient a new reader, reusing complete saved facts only. */
export function projectSnapshot(session:FocusSession):ProjectSnapshotBlock[] {
 if(session.mode!=="work"||session.projectMaintenance?.overview!==undefined||session.briefUserEdited)return [];
 const rows:ProjectSnapshotBlock[]=[],seen=new Set<string>();let characters=0;
 const view=projectKnowledgeView(session),introductoryText=factTextKey(projectKnowledgeIntroduction(session));
 const limits={scope:1,workflow:1,architecture:1,decision:2,constraint:1,status:2,questions:3};
 const add=(row:ProjectSnapshotBlock)=>{
  const key=factTextKey(row.text);
  // A chapter's editorial opening is not a project-wide workflow/architecture
  // statement. Keep it in the article; do not lift "this chapter establishes"
  // into the project's overview as another factual conclusion.
  if(["workflow","architecture"].includes(row.role)&&/^(?:本章|本节|这一章|this chapter\b|this section\b)/iu.test(row.text.trim()))return;
  if(!key||seen.has(key)||introductoryText.includes(key)||characters+row.text.length>1600)return;
  if(row.role==="scope"&&introductoryText)return;
  if(rows.filter(item=>item.role===row.role).length>=limits[row.role])return;
  seen.add(key);characters+=row.text.length;rows.push(row);
 };
 for(const role of ["scope","workflow","decision","constraint","status"] as const){
  if(role==="status"&&view.stages.length){
   const handled=new Set<string>();
   for(const stage of view.stages){
    const conflict=view.conflicts.find(group=>group.facts.includes(stage));
    if(conflict){
     if(handled.has(conflict.axis))continue;handled.add(conflict.axis);
     add({role,text:(session.locale==="en"?"Stage records require reconciliation: ":"阶段记录尚待统一：")+conflict.facts.map(fact=>fact.claim.text).join("；"),evidenceIds:[...new Set(conflict.facts.flatMap(fact=>fact.claim.evidenceIds))],sectionIds:[...new Set(conflict.facts.map(fact=>fact.sectionId))],status:"draft"});
    }else add({role,text:(view.stages.length>1&&stage.claim.scope?stage.claim.scope+"："+ "":"")+knowledgeFactText(stage,session.locale!=="en"),evidenceIds:stage.claim.evidenceIds,sectionIds:[stage.sectionId],status:"reported"});
   }
  }
  for(const fact of view.current){
   const claim=fact.claim,selected=role==="status"?claim.overviewRole==="progress":claim.overviewRole===role;
   if(!selected||fact.contested&&role!=="status"||role==="status"&&fact.implementation!=="reported")continue;
   if(!session.evidence.some(ref=>claim.evidenceIds.includes(ref.id)))continue;
   add({role:role==="workflow"?workflowRole(claim.text):role,text:evidencePresentation(knowledgeFactText(fact,session.locale!=="en")),evidenceIds:claim.evidenceIds,sectionIds:[fact.sectionId],status:fact.status==="reported"?"reported":fact.adoption==="accepted"?"confirmed":fact.status==="proposal"?"proposal":fact.status==="planned"?"planned":fact.status==="draft"?"draft":"background"});
  }
 }
 for(const conflict of view.conflicts.filter(group=>!group.facts.some(fact=>fact.role==="stage"))){
  add({role:"status",text:(session.locale==="en"?"The relationship between these choices is unresolved: ":"这些方案记录的关系尚未明确：")+conflict.facts.map(fact=>fact.claim.text).join("；"),evidenceIds:[...new Set(conflict.facts.flatMap(fact=>fact.claim.evidenceIds))],sectionIds:[...new Set(conflict.facts.map(fact=>fact.sectionId))],status:"draft"});
 }
 // Compatibility: a complete architectural paragraph is background, not adoption.
 if(!rows.length)for(const section of session.sections){
  if(section.userEdited||section.origin||section.reviewIssue||!["review","finding"].includes(section.kind))continue;
  const paragraph=discussionBlocks(projectKnowledgeSection(section,session).body).find(block=>block.text.trim().length>=60&&block.text.length<=450&&!/^\s*(?:[#>`~|*-]|\d+[.)])/u.test(block.text));
  if(!paragraph||!section.evidenceIds.length||introductoryText.includes(factTextKey(evidencePresentation(paragraph.text))))continue;
  if(!/架构|系统|流程|工作流|architecture|system|workflow/iu.test(section.title))continue;
  add({role:workflowRole(paragraph.text,true),text:evidencePresentation(paragraph.text),evidenceIds:[...section.evidenceIds],sectionIds:[section.id],status:"draft"});break;
 }
 for(const question of view.questions)add({role:"questions",text:question.text,evidenceIds:question.sources.map(ref=>ref.id),sectionIds:[],status:"draft"});
 return rows;
}
