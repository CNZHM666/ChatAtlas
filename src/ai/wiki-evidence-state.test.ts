import {expect,it} from "vitest";
import {reviewWikiEvidenceStates} from "./wiki-evidence-state";
import type {WikiDraftChapter,WikiKnowledgeLedger,WikiKnowledgeUnit} from "../shared/wiki-knowledge";
const unit=(id:string,statement:string):WikiKnowledgeUnit=>({id,subject:"订单校验",statement,kind:"plan",delivery:"planned",details:[],adoption:{status:"proposal"},evidence:{evidenceId:id,conversationId:"c",messageId:id,messageIndex:1,role:"assistant",pasted:false,quote:statement}});
const chapter=(text:string,ids:string[]):WikiDraftChapter=>({id:"ch",title:"计划",question:"",group:"",body:text,problems:[],paragraphs:[{text,subtopic:"计划",unitIds:ids,claims:[{text,unitIds:ids}]}]});
const ledger=(units:WikiKnowledgeUnit[]):WikiKnowledgeLedger=>({version:1,generatedAt:1,status:"complete",materials:1,batches:[{sourceIds:[],status:"ok",units,rejected:{}}]});
it("keeps a proposed metric's release qualification attached after it becomes a list item",()=>{
 const metric="**同步成功率**：> 95%",goal=unit("g","第一阶段目标为同步成功率 > 95%。"),decision=unit("answer:q:no","V1 暂缓云同步。");
 const l=ledger([goal,decision]);
 l.decisions={[decision.id]:{verdict:"confirmed",at:2}};
 l.userAnswers=[{questionId:"q",question:"云同步是否纳入 V1？",answer:"暂缓",optionId:"no",at:2,unitIds:[goal.id]}];
 const input=chapter(`- ${metric}\n- **导入成功率**：> 90%`,[goal.id]);
 input.paragraphs[0].claims=[{text:metric,unitIds:[goal.id]}];
 const result=reviewWikiEvidenceStates([input],l);
 expect(result[0].body).toBe(input.body);
 l.userAnswers[0].question="同步是否纳入 V1？";
 const qualified=reviewWikiEvidenceStates([input],l);
 expect(qualified[0].body).toBe(`- ${metric}（建议指标，适用版本待核对）\n- **导入成功率**：> 90%`);
 expect(reviewWikiEvidenceStates(qualified,l)).toEqual(qualified);
});

it("retains both rollout proposals when one reserves a feature and another describes first-release behavior",()=>{
 const allow=unit("a","第一版仅支持单张清晰照片识别。"),hold=unit("h","预留图像字段，但本阶段禁止开发拍照识别。"),l=ledger([allow,hold]);
 const result=reviewWikiEvidenceStates([chapter(allow.statement,[allow.id])],l);
 expect(result[0].body).toContain("两份提案的阶段关系待核对");
 expect(result[0].body).toContain("单张清晰照片识别");
 l.decisions={a:{verdict:"confirmed",at:2}};
 expect(reviewWikiEvidenceStates([chapter(allow.statement,[allow.id])],l)[0].body).toBe(allow.statement);
});
it("keeps a test plan from becoming completion, including in a mixed opening",()=>{
 const l=ledger([unit("p","建议新增订单测试与回归测试。")]),input=chapter("质量方面建立了自动化测试体系。发布方面建议先收集反馈。",["p"]);
 const result=reviewWikiEvidenceStates([input],l);
 expect(result[0].body).toBe("质量方面计划建立自动化测试体系。发布方面建议先收集反馈。");
 expect(input.body).toContain("建立了");expect(reviewWikiEvidenceStates(result,l)).toEqual(result);
 l.batches[0].units[0].delivery="user_reported";
 expect(reviewWikiEvidenceStates([input],l)[0]).toBe(input);
});
it("shows requirements separately from unverified implementation and preserves original source tables",()=>{
 const text="| 功能 | V2 |\n| --- | --- |\n| 订单去重 | 必须检查 |\n| 退款 | 支持 |",u=unit("p","V2 计划检查重复订单并支持退款。"),l=ledger([u]);
 const result=reviewWikiEvidenceStates([chapter(text,["p"])],l);
 expect(result[0].body).toContain("目标要求（原表：V2） | 实现核验");
 expect(result[0].body).toContain("| 订单去重 | 必须检查 | 待核验 |");
 expect(reviewWikiEvidenceStates(result,l)).toEqual(result);
 const reported={...u,kind:"report" as const,delivery:"user_reported" as const,statement:"V2 已支持退款，并检查重复订单。"};
 expect(reviewWikiEvidenceStates([chapter(text,["p"])],ledger([reported]))[0].body).toBe(text);
 u.evidence.code={language:"table",text};expect(reviewWikiEvidenceStates([chapter(text,["p"])],l)[0].body).toBe(text);
});
it("does not let a related quota proposal become the selected quota through another unit",()=>{
 const a=unit("a","套餐保持10人。"),b=unit("b","默认团队上限20人。"),d=unit("answer:q:yes","团队人数：先保持10人。"),l=ledger([a,b,d]);
 l.decisions={[d.id]:{verdict:"confirmed",at:2}};
 l.writingQuestions=[{id:"q",organization:1,about:"团队人数规模",ask:"10人还是20人？",unitIds:["a"],options:[{id:"yes",label:"先保持10人",actions:[{do:"confirm",units:["a"]}]}]}];
 l.userAnswers=[{questionId:"q",question:"10人还是20人？",answer:"先保持10人",optionId:"yes",unitIds:["a"],at:2}];
 l.organization={version:1,generatedAt:1,status:"complete",subjects:[{id:"s",name:"团队人数",aliases:[],unitIds:["a","b",d.id]}],chapters:[],relations:[],merged:[],report:{}};
 const result=reviewWikiEvidenceStates([chapter(b.statement,["b"])],l);
 expect(result[0].body).toContain("范围待核对的候选建议");expect(result[0].body).toContain(b.statement);
 expect(reviewWikiEvidenceStates(result,l)).toEqual(result);
 const candidate=chapter(`其他候选记录（不作为当前确认范围）：${b.statement}`,["b"]);
 expect(reviewWikiEvidenceStates([candidate],l)[0]).toBe(candidate);
 b.statement="准备5个测试订单。";
 expect(reviewWikiEvidenceStates([chapter(b.statement,["b"])],l)[0].body).toBe(b.statement);
});

it("keeps conflicting credential storage requirements explicitly unresolved",()=>{
 const store=unit("store","API Key 可选保存在 sessionStorage。"),ban=unit("ban","检查所有存储层均无完整 API Key。"),l=ledger([store,ban]);
 const result=reviewWikiEvidenceStates([chapter(ban.statement,[ban.id])],l);
 expect(result[0].body).toContain("需先确认允许保存的位置");
 expect(reviewWikiEvidenceStates(result,l)).toEqual(result);
});
