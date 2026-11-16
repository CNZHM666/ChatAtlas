import {expect,it} from "vitest";
import {retainWikiDecisions,reviewWikiEditorial} from "./wiki-editorial-review";
import {withAnsweredChoices,withAnswerScope} from "./wiki-question-parse";
import {wikiDecisionRestatement,wikiLayerDeferral} from "./wiki-confirmation-scope";
import {placeWikiChoices} from "./wiki-choice-placement";
import {wikiWorkflowScopes} from "./wiki-workflow-scope";
import {wikiConfirmedScopeText} from "../shared/wiki-overview";
import type {WikiKnowledgeLedger,WikiKnowledgeUnit,WikiDraftChapter} from "../shared/wiki-knowledge";
const unit=(id:string,statement:string):WikiKnowledgeUnit=>({id,subject:"项目",statement,kind:"plan",details:[],adoption:{status:"proposal"},delivery:"unknown",evidence:{evidenceId:id,conversationId:"c",messageId:id,messageIndex:1,role:"assistant",pasted:false,quote:statement}});
const chapter=(text:string,unitIds:string[]):WikiDraftChapter=>({id:"c",title:"竞品参考",question:"",group:"",body:text,problems:[],paragraphs:[{subtopic:"方案",text,unitIds,claims:[{text,unitIds}]}]});
const ledger=(units:WikiKnowledgeUnit[]):WikiKnowledgeLedger=>({version:1,generatedAt:1,status:"complete",materials:1,batches:[{sourceIds:[],status:"ok",units,rejected:{}}]});
it("keeps the named layer as the subject of a deferral",()=>{
 const question="Level 2 (Exports) 目前仅预留不实现，后续是否启动该层级开发？";
 expect(wikiLayerDeferral(question,"维持现状，暂不开发")).toBe("Level 2 (Exports)：维持预留，暂不开发。");
 expect(wikiLayerDeferral("导出系统目前是否开发？","维持现状，暂不开发")).toBeUndefined();
 expect(wikiLayerDeferral(question,"纳入下一里程碑规划")).toBeUndefined();
});
it("reads confirmation of scope without declaring delivery",()=>{
 expect(wikiConfirmedScopeText("当前已确认实现协作功能。用户报告已部署搜索。"))
  .toBe("已确认的范围包括 协作功能。用户报告已部署搜索。");
});

it("keeps a confirmed return route separate from a broader answer about how another entry shows suggestions",()=>{
 const route=unit("r","用户确认附件后，系统应返回表单并标记已上传。"),anchor=unit("a","“附件库”负责管理附件，取消常驻建议并改为 Drawer 展示建议。"),feedback=unit("f","确认成功后显示“已归档”并推荐其他资料。");
 const l=ledger([route,anchor,feedback]);
 l.writingQuestions=[{id:"route",organization:1,about:"附件确认",ask:"用户确认附件后，是返回表单并标记已上传，还是显示“已归档”并推荐其他资料？",unitIds:["r"],options:[{id:"yes",label:"返回并标记",actions:[{do:"confirm",units:["r"]}]}]},
  {id:"entry",organization:1,about:"附件库建议",ask:"关于“附件库”取消常驻建议并改为 Drawer 展示建议的方案，是否确认实施？",unitIds:["a","f"],options:[{id:"yes",label:"确认实施",actions:[{do:"confirm",units:["a","f"]}]}]}];
 l.userAnswers=l.writingQuestions.map((q,index)=>({questionId:q.id,question:q.ask,answer:q.options[0].label,optionId:"yes",unitIds:q.unitIds,at:index+2}));
 l.decisions={r:{verdict:"confirmed",at:2},f:{verdict:"confirmed",at:3}};
 const result=withAnsweredChoices(l);
 expect(result.decisions).toMatchObject({r:{verdict:"confirmed"},"answer:entry:yes":{verdict:"confirmed"}});
 expect(result.decisions?.f).toBeUndefined();
 expect(result.batches[0].units.find(u=>u.id==="answer:entry:yes")?.statement).toBe("「附件库」取消常驻建议并改为 Drawer 展示建议。");
 const workflow=wikiWorkflowScopes(result,new Map(result.batches[0].units.map(u=>[u.id,u])));
 expect(workflow.qualify(feedback.statement,["f"])).toContain("「附件库」的独立入口中，讨论中的成功反馈建议");
 expect(workflow.qualify(route.statement,["r"])).toContain("「表单」的识别流程中");
});

it("keeps a release choice in its owning topic while preserving the opening's other sentence and source examples",()=>{
 const source=unit("s","首发可发布 v1.2.0-alpha 标签。"),choice=unit("answer:q:yes","发布v1.2.0-alpha标签。"),l=ledger([source,choice]);
 l.organization={version:1,generatedAt:1,status:"complete",merged:[],report:{},relations:[],subjects:[{id:"s",name:"发布",aliases:[],unitIds:[source.id,choice.id]}],chapters:[{id:"c",title:"发布",question:"",group:"",subtopics:[{title:"发布流程",subjectIds:["s"]}]}]};
 l.userAnswers=[{questionId:"q",question:"如何发布？",answer:choice.statement,optionId:"yes",unitIds:[source.id],at:2}];
 l.decisions={[choice.id]:{verdict:"confirmed",at:2}};
 const input=chapter(`先完成独立验收。首个公开版本已确认为 v1.2.0-alpha 标签。\n\n### 发布流程\n\n${choice.statement}\n\n\`\`\`text\n${choice.statement}\n\`\`\`\n\n### 已确认的取舍\n\n${choice.statement}`,[choice.id]);
 input.paragraphs=[{text:choice.statement,subtopic:"发布流程",unitIds:[choice.id],claims:[{text:choice.statement,unitIds:[choice.id]}]}];
 const [result]=placeWikiChoices([input],l);
 expect(result.body).toContain("先完成独立验收。");
 expect(result.body).not.toMatch(/首个公开版本|已确认的取舍/u);
 expect(result.body.split(choice.statement)).toHaveLength(3);
 expect(result.paragraphs).toEqual(input.paragraphs);
});
it("retains a confirmed choice when its unit is cited but its claim is absent",()=>{
 const decision=unit("u","手机端第一阶段支持完整画布编辑。"),l=ledger([decision]);
 l.organization={subjects:[{id:"s",unitIds:["u"]}],chapters:[{id:"c",subtopics:[{subjectIds:["s"]}]}]} as WikiKnowledgeLedger["organization"];
 const input=chapter("画布功能见原讨论。",["u"]);
 input.paragraphs[0].claims=[];
 const output=retainWikiDecisions([input],l,new Set(["u"]),true);
 expect(output[0].body).toContain(decision.statement);
 expect(output[0].paragraphs.at(-1)?.claims).toEqual([{text:decision.statement,unitIds:["u"]}]);
 expect(retainWikiDecisions(output,l,new Set(["u"]),true)).toEqual(output);
 expect(retainWikiDecisions([input],l,new Set(),true)).toEqual([input]);
});
it("retains unrouted confirmed decisions and ignores history-only coverage",()=>{
 const decision=unit("u","手机端第一阶段支持完整画布编辑。"),l=ledger([decision]);
 l.organization={subjects:[],chapters:[]} as unknown as WikiKnowledgeLedger["organization"];
 const input=chapter(`### 早先版本\n\n${decision.statement}`,["u"]);
 input.paragraphs[0].subtopic="早先版本";
 const result=retainWikiDecisions([input],l,new Set(["u"]),true);
 expect(result[0].paragraphs.at(-1)?.subtopic).toBe("已确认的决定补记");
 expect(result[0].paragraphs.at(-1)?.text).toBe(decision.statement);
 expect(retainWikiDecisions(result,l,new Set(["u"]),true)).toEqual(result);
});
it("keeps a proposed expansion count separate from the confirmed initial count",()=>{
 const source=unit("u","先做稳6个基础元件，再逐步扩展至约15个。"),l=ledger([source]);
 l.decisions={u:{verdict:"confirmed",at:2}};
 l.writingQuestions=[{id:"q",organization:1,about:"元件规模",ask:"先做6个还是直接扩充？",unitIds:["u"],options:[{id:"six",label:"先做稳6个，再逐步扩展",actions:[{do:"confirm",units:["u"]}]}]}];
 l.userAnswers=[{questionId:"q",unitIds:["u"],question:"先做6个还是直接扩充？",answer:"先做稳6个，再逐步扩展",optionId:"six",at:2}];
 const row="| 元件库规模 | 先做稳6个，再逐步扩展至约15个（AI 建议，待确认） |";
 const input=chapter(row,["u"]);
 const projected=reviewWikiEditorial([input],withAnsweredChoices(l))[0];
 expect(projected.body).toContain("| 后续元件库规模 | AI 建议逐步扩展至约 15 个元件，数量待确认。 |");
 expect(projected.body).not.toContain("6个，再逐步扩展至");
});
it("records an affirmative alternative that only rejects the old proposal, separate from its history",()=>{
 const old=unit("u","手机第一阶段仅查看，不支持编辑。"),l=ledger([old]);
 l.decisions={u:{verdict:"rejected",at:2}};
 l.writingQuestions=[{id:"q",organization:1,about:"手机第一阶段能力",ask:"是否支持编辑？",unitIds:["u"],options:[{id:"yes",label:"支持完整画布编辑",actions:[{do:"reject",units:["u"]}]}]}];
 l.userAnswers=[{questionId:"q",unitIds:["u"],question:"是否支持编辑？",answer:"支持完整画布编辑",optionId:"yes",at:2}];
 const normalized=withAnsweredChoices(l),current=normalized.batches.flatMap(batch=>batch.units).find(unit=>unit.id==="answer:q:yes")!;
 expect(current.statement).toBe("手机第一阶段能力：支持完整画布编辑。");expect(normalized.decisions?.[current.id].verdict).toBe("confirmed");
 expect(withAnsweredChoices(normalized)).toBe(normalized);
 const legacy={...normalized,batches:[...normalized.batches,{...normalized.batches[0],units:[current]}]};
 expect(withAnsweredChoices(legacy).batches.flatMap(batch=>batch.units).filter(item=>item.id===current.id)).toEqual([current]);
 expect(legacy.batches.at(-1)?.units).toEqual([current]);
 const input=chapter("手机第一阶段支持完整画布编辑，原先仅查看方案已被否定。",["u"]);input.paragraphs[0].subtopic="早先版本";
 const result=reviewWikiEditorial([input],normalized)[0];
 expect(result.paragraphs.find(p=>p.subtopic==="早先版本")?.text).not.toContain("支持完整画布编辑");
 expect(result.paragraphs.some(p=>p.subtopic==="已确认的取舍"&&p.unitIds.includes(current.id))).toBe(true);
});

it("cleans repeated copies of one confirmed unit in the saved supplement without dropping distinct details",()=>{
 const decision=unit("u","第一阶段支持附件编辑。"),detail=unit("detail","第一阶段支持附件编辑。批量编辑需要管理员权限。"),l=ledger([decision,detail]);
 l.organization={subjects:[],chapters:[]} as unknown as WikiKnowledgeLedger["organization"];
 const title="已确认的决定补记";
 const input=chapter(`收件阶段的概况。\n\n### ${title}\n\n${decision.statement}\n\n${decision.statement}\n\n${detail.statement}\n\n\`\`\`text\n${decision.statement}\n\`\`\``,[decision.id]);
 const row=(u:WikiKnowledgeUnit)=>({subtopic:title,text:u.statement,unitIds:[u.id],claims:[{text:u.statement,unitIds:[u.id]}]});
 input.paragraphs=[row(decision),row(decision),row(detail)];
 const before=structuredClone(input),confirmed=new Set([decision.id,detail.id]);
 const [result]=retainWikiDecisions([input],l,confirmed,true);
 expect(result.body).toBe(before.body.replace(`${decision.statement}\n\n${decision.statement}`,decision.statement));
 expect(result.paragraphs).toEqual([row(decision),row(detail)]);
 expect(retainWikiDecisions([result],l,confirmed,true)).toEqual([result]);
 expect(input).toEqual(before);
});
it("limits a rejection to the question axis instead of rejecting an entire architecture",()=>{
 const source=unit("u","建立本地 Catalog，初期录入30个元件。"),l=ledger([source]);
 l.decisions={u:{verdict:"rejected",at:1}};
 l.writingQuestions=[{id:"q",organization:1,about:"初期元件数量",ask:"先做6个还是30个？",unitIds:["u"],options:[]}];
 l.userAnswers=[{questionId:"q",unitIds:["u"],question:"先做6个还是30个？",answer:"先做6个",at:1}];
 const input=[chapter("你否定了建立本地 Catalog 和录入30个元件。",["u"])],before=structuredClone(input);
 const result=reviewWikiEditorial(input,l);
 expect(result[0].body).toContain("关于初期元件数量");expect(result[0].body).not.toContain("否定了建立本地 Catalog");expect(input).toEqual(before);
});
it("does not repeatedly prefix alternatives when saved generated prose is reviewed again",()=>{
 const old=unit("u","初期录入30个元件。"),l=ledger([old]);
 l.decisions={u:{verdict:"rejected",at:2}};
 l.writingQuestions=[{id:"q",organization:1,about:"元件数量",ask:"数量？",unitIds:["u"],options:[{id:"six",label:"使用6个元件",actions:[{do:"reject",units:["u"]}]}]}];
 l.userAnswers=[{questionId:"q",unitIds:["u"],question:"数量？",answer:"使用6个元件",optionId:"six",at:2}];
 const normalized=withAnsweredChoices(l),once=reviewWikiEditorial([chapter(old.statement,["u"])],normalized);
 expect(reviewWikiEditorial(once,normalized)).toEqual(once);
 expect(once[0].body.match(/其他候选记录/g)).toHaveLength(1);
});
it("restores next-phase wording without altering source code or inventing current progress",()=>{
 const source=unit("u","下一阶段开发拍照识别。"),l=ledger([source]);
 expect(reviewWikiEditorial([chapter("当前阶段开发拍照识别。",["u"])],l)[0].body).toBe(source.statement);
 const literal=chapter('```text\n当前阶段开发拍照识别。\n```',["u"]);
 expect(reviewWikiEditorial([literal],l)[0].body).toBe(literal.body);
});

it("recognizes a bound decision in the opening and does not repeat it in the supplement",()=>{
 const decision=unit("u","手机端能力：支持编辑。"),l=ledger([decision]);
 l.organization={subjects:[],chapters:[]} as unknown as WikiKnowledgeLedger["organization"];
 const opening="手机端能力确认为支持编辑。";
 const input=chapter(`${opening}\n\n### 已确认的决定补记\n\n${decision.statement}`,["u"]);
 input.openingUnitIds=["u"];
 input.paragraphs[0]={subtopic:"已确认的决定补记",text:decision.statement,unitIds:["u"],claims:[{text:decision.statement,unitIds:["u"]}]};
 expect(retainWikiDecisions([input],l,new Set(["u"]),true)[0].body).toBe(opening);
 expect(wikiDecisionRestatement("首个公开版本确认为发布 v1.2-alpha 标签。","发布v1.2-alpha标签。")).toBe(true);
 expect(wikiDecisionRestatement("首个公开版本确认为发布 v1.2-alpha 标签，并开放全部功能。","发布v1.2-alpha标签。")).toBe(false);
});

it("writes the confirmed trigger inside its owning topic and keeps a deferred feature in the full journey",()=>{
 const preview=unit("u","在草稿阶段显示概念预览，便于审阅方案。"),later=unit("v","完整旅程依次收集需求、生成草稿，最后进行仿真。"),l=ledger([preview,later]);
 l.organization={version:1,generatedAt:1,status:"complete",merged:[],report:{},relations:[],subjects:[{id:"s",name:"流程",aliases:[],unitIds:["u","v"]}],chapters:[{id:"c",title:"流程",question:"",group:"",subtopics:[{title:"操作流程",subjectIds:["s"]}]}]};
 l.decisions={u:{verdict:"confirmed",at:1},v:{verdict:"confirmed",at:2}};
 l.writingQuestions=[
  {id:"q",organization:1,about:"预览显示时机",ask:"概念预览何时显示？",unitIds:["u"],options:[{id:"yes",label:"草稿保存时自动显示",actions:[{do:"confirm",units:["u"]}]}]},
  {id:"v",organization:1,about:"仿真功能",ask:"仿真是否纳入 V1 验证流程？",unitIds:["v"],options:[{id:"no",label:"暂缓，排除在本阶段外",actions:[{do:"confirm",units:["v"]}]}]},
 ];
 l.userAnswers=[
  {questionId:"q",unitIds:["u"],question:l.writingQuestions[0].ask,answer:l.writingQuestions[0].options[0].label,optionId:"yes",at:1},
  {questionId:"v",unitIds:["v"],question:l.writingQuestions[1].ask,answer:l.writingQuestions[1].options[0].label,optionId:"no",at:2},
 ];
 preview.kind="plan";later.kind="fact";
 const reading=withAnsweredChoices(withAnswerScope(l));
 const input=chapter(`### 操作流程\n\n${later.statement}`,["v"]);
 input.paragraphs[0]={subtopic:"操作流程",text:later.statement,unitIds:["v"],claims:[{text:later.statement,unitIds:["v"]}]};
 const document=reviewWikiEditorial([input],reading)[0];
 expect(document.body).toContain("完整流程设想：完整旅程");
 expect(document.body).toContain("V1 暂缓仿真");
 expect(document.paragraphs.find(p=>p.unitIds.includes("answer:q:yes"))?.subtopic).toBe("操作流程");
 expect(document.body).toContain("草稿保存时自动显示");
});
it("restores a competitor explicitly retained in an answer and is idempotent",()=>{
 const source={...unit("u","Example 是外部竞品，采用模块化工作流。"),kind:"fact" as const,about:{name:"Example",role:"competitor" as const}},l=ledger([source]);
 l.writingQuestions=[{id:"q",organization:1,about:"项目关系",ask:"竞品还是自有？",unitIds:["u"],options:[{id:"o",label:"竞品",actions:[{do:"owner",units:["u"],name:"Example",answer:"reference"}]}]}];
 l.userAnswers=[{questionId:"q",unitIds:["u"],question:"竞品还是自有？",answer:"竞品",optionId:"o",at:1}];
 const result=reviewWikiEditorial([chapter("其他开源工具。",[])],l);
 expect(result[0].body).toContain(source.statement);expect(reviewWikiEditorial(result,l)).toEqual(result);
});
