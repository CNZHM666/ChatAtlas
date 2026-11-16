import {expect,it} from "vitest";
import {reviewSavedWikiEditorial} from "./wiki-saved-editorial";
import {withAnsweredChoices} from "./wiki-question-parse";
import {contextKnowledge} from "../test/context-fixture";
import type {WikiKnowledgeLedger,WikiKnowledgeUnit} from "../shared/wiki-knowledge";
import {projectDocument} from "../export/project-document";

function fixture(){
 const session=contextKnowledge().session,section=session.sections[0],source=session.evidence[0];
 const old="手机第一阶段仅查看，不支持编辑。",text="手机第一阶段支持完整画布编辑，此前仅查看的方案已被否定。";
 source.excerpt=old;session.sourceRoles![source.conversationId][source.messageId]="assistant";
 const unit:WikiKnowledgeUnit={id:"u",subject:"手机端",statement:old,kind:"plan",details:[],adoption:{status:"proposal"},delivery:"unknown",evidence:{evidenceId:source.id,conversationId:source.conversationId,messageId:source.messageId,messageIndex:0,role:"assistant",pasted:false,quote:old}};
 const ledger:WikiKnowledgeLedger={version:1,generatedAt:1,status:"complete",materials:1,batches:[{sourceIds:[],status:"ok",units:[unit],rejected:{}}],decisions:{u:{verdict:"rejected",at:2}},writingQuestions:[{id:"q",organization:1,about:"手机第一阶段能力",ask:"是否支持编辑？",unitIds:["u"],options:[{id:"no",label:"仅查看",actions:[{do:"confirm",units:["u"]}]},{id:"yes",label:"支持完整画布编辑",actions:[{do:"reject",units:["u"]}]}]}],userAnswers:[{questionId:"q",unitIds:["u"],question:"是否支持编辑？",answer:"支持完整画布编辑",optionId:"yes",at:2}]};
 section.body=`### 早先版本\n\n- ${text}`;section.claims=[{text,quote:old,unitIds:["u"],evidenceIds:[source.id],holder:"earlier"}];
 ledger.draft={version:1,generatedAt:1,status:"complete",chapters:[{id:section.id,title:section.title,question:"",group:"",body:section.body,problems:[],paragraphs:[{text,subtopic:"早先版本",unitIds:["u"],claims:[{text,unitIds:["u"]}]}]}],report:{}};
 session.wikiKnowledge=ledger;
 return {session,section,source,ledger};
}
it("separates a saved mixed historical claim from the explicit current answer without mutating the saved article",()=>{
 const {section,source,ledger}=fixture(),before=structuredClone(section);
 const result=reviewSavedWikiEditorial(section,withAnsweredChoices(ledger),()=>source);
 expect(result.body.split("### 已确认的取舍")[0]).not.toContain("支持完整画布编辑");
 expect(result.body).toContain("### 已确认的取舍\n\n手机第一阶段能力：支持完整画布编辑。");
 expect(result.claims?.at(-1)).toMatchObject({holder:"decided",unitIds:["answer:q:yes"],evidenceIds:[source.id]});
 expect(section).toEqual(before);expect(reviewSavedWikiEditorial(result,withAnsweredChoices(ledger),()=>source)).toEqual(result);
 expect(reviewSavedWikiEditorial({...section,userEdited:true},withAnsweredChoices(ledger),()=>source).body).toBe(section.body);
 expect(reviewSavedWikiEditorial(section,withAnsweredChoices(ledger),()=>undefined)).toBe(section);
 const literal={...section,body:`<details data-atlas="atlas-wiki-supplement">\n<summary>原文与示例</summary>\n\n${section.body}\n\n</details>`};
 expect(reviewSavedWikiEditorial(literal,withAnsweredChoices(ledger),()=>source)).toBe(literal);
});
it("includes the current choice in the Markdown overview when exporting an older saved draft",()=>{
 const {session,section}=fixture();
 const md=projectDocument(session,{overview:true,wikiIds:[section.id],matters:false,history:false,sources:false},"md").text;
 const decisions=md.split("### 已定的关键决定")[1]?.split("### 待决问题")[0]??"";
 expect(decisions,md).toContain("支持完整画布编辑");
 expect(md).toMatch(/手机第一阶段能力：支持完整画布编辑。\s*〔已定〕/u);
});
