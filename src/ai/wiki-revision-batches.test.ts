import "fake-indexeddb/auto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {projectSession} from "../test/project-fixture";
import {cacheAIResult} from "../storage/ai-result-cache";
import {getDatabase} from "../storage/db";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {reviseWikiChapters} from "./wiki-revision";
import {prepareWikiRevisionBatches} from "./wiki-revision-batches";
import {revisionMarkdownUnits} from "./wiki-revision-materials";
import {requestBudget} from "./request-policy";
import type {AtlasAIProvider,StructuredAIRequest} from "./provider";
import type {ConversationMessage} from "../shared/types";
import { aiRetryTiming } from "./atlas-ai";
// These cases drive many provider retries; their pauses need not pass in real time.
beforeAll(() => { aiRetryTiming.scale = 0; });
afterAll(() => { aiRetryTiming.scale = 1; });

function fixture(){
 const session=projectSession();session.id=crypto.randomUUID();session.locale="zh-CN";
 const paragraphs=Array.from({length:75},(_,i)=>`记录${i}：只有用户确认来源后才生成第${i}个结果，失败时保留原稿。`+`第${i}项保留独立运行条件与完整参数，不能因为重复词语而省略不同的版本。`.repeat(10));
 session.sections[0].body=Array.from({length:10},(_,i)=>`## 操作${i}\n\n${paragraphs[i]}`).join("\n\n");
 const raw:ConversationMessage={id:"message",conversationId:"source",role:"user",messageIndex:0,content:paragraphs.join("\n\n"),preview:"",contentHash:"",createdAt:1,updatedAt:1};
 session.sections[0].claims=[];
 return {session,raw,paragraphs};
}
function response<T>(request:StructuredAIRequest<T>){
 const data=JSON.parse(request.prompt);
 if(data.presentation==="wiki_section_rewrite")return {body:data.chapter.body,claims:[]};
 if(data.presentation==="wiki_content_plan")return {chapters:data.chapters.map((chapter:{id:string})=>({id:chapter.id,topics:[{title:"操作规则",topicIds:data.topics.filter((topic:{chapterId:string})=>topic.chapterId===chapter.id).map((topic:{id:string})=>topic.id)}]}))};
 if(data.presentation==="wiki_revision_sources")return {assignments:data.units.map((unit:{id:string;eligibleOwners:string[]},index:number)=>({unitId:unit.id,sectionIds:[unit.eligibleOwners[index%unit.eligibleOwners.length]]}))};
 if(data.presentation!=="wiki_revision_batch")throw Error(`Unexpected ${data.presentation}`);
 return {blocks:data.units.map((unit:{id:string;kind:string;topic:string;text:string;literal?:boolean;evidenceIds:string[]})=>({topic:data.topics.includes(unit.topic)?unit.topic:data.chapter.title,unitIds:[unit.id],body:unit.literal&&unit.kind==="draft"?"":unit.text.replace(/^(?:#{1,6}[ \t]+[^\n]*\n[\r\n\t ]*)+/u,"").trim(),verbatimUnitIds:unit.literal&&unit.kind==="draft"?[unit.id]:undefined,claims:[]}))};
}
function provider(namespace:string,model="fixture"){
 const calls:StructuredAIRequest<unknown>[]=[],raw:AtlasAIProvider={id:"openai",modelId:model,capabilities:{textGeneration:true,structuredOutput:"json",embeddings:false,maxConcurrency:1},testConnection:async()=>({ok:true,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls.push(request as StructuredAIRequest<unknown>);return request.validate(response(request as StructuredAIRequest<unknown>));}};
 const ai=createAtlasAIFromProvider(raw,{id:"ai-settings",provider:"openai",model,baseUrl:`https://${namespace}.invalid/v1`,apiKey:"fixture",updatedAt:1});return {ai,calls,raw};
}

it("automatically partitions a long chapter, covers every original byte and locally assembles all unique details",async()=>{
 const {session,raw,paragraphs}=fixture(),before=structuredClone(session),{ai,calls}=provider(crypto.randomUUID()),progress=vi.fn();
 const result=await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal,progress);
 expect(calls.length).toBeGreaterThan(1);expect(calls.every(request=>JSON.parse(request.prompt).presentation==="wiki_revision_batch")).toBe(true);
 for(const request of calls)expect(requestBudget(request,"fixture").inputTokens).toBeLessThanOrEqual(12000);
 const sourceUnits=calls.flatMap(request=>JSON.parse(request.prompt).units).filter(unit=>unit.kind==="source");
 expect(sourceUnits.map(unit=>unit.text).join("")).toBe(raw.content);expect(new Set(sourceUnits.map(unit=>unit.id)).size).toBe(sourceUnits.length);
 for(const text of paragraphs)expect(result.sections[0].body).toContain(text);
 expect(result.wikiRevisionReceipt).toMatchObject({batches:calls.length,draftUnits:10,sourceUnits:75,cachedBatches:0});expect(session).toEqual(before);
 expect(progress.mock.calls.at(-1)?.[2]).toMatchObject({stage:"checking"});
},20000);

it("routes shared long sources once across chapters and reuses both ownership and writing checkpoints",async()=>{
 const {session,raw}=fixture(),{ai,calls}=provider(crypto.randomUUID());
 session.sections.push({...session.sections[0],id:"two",title:"运行机制",body:"## 核心边界\n\n必须保留全部运行条件。"});
 const result=await reviseWikiChapters(session,["one","two"],[raw],"",ai,new AbortController().signal);
 const writing=calls.filter(request=>JSON.parse(request.prompt).presentation==="wiki_revision_batch"),sourceUnits=writing.flatMap(request=>JSON.parse(request.prompt).units).filter(unit=>unit.kind==="source");
 expect(calls.some(request=>JSON.parse(request.prompt).presentation==="wiki_revision_sources")).toBe(true);
 expect(sourceUnits).toHaveLength(75);expect(new Set(sourceUnits.map(unit=>unit.id)).size).toBe(75);
 expect(result.sections).toHaveLength(2);const before=calls.length;
 const again=await reviseWikiChapters(session,["one","two"],[raw],"",ai,new AbortController().signal);
 expect(calls).toHaveLength(before);expect(again.wikiRevisionReceipt?.cachedBatches).toBe(again.wikiRevisionReceipt?.batches);
},20000);

it("resumes only unfinished batches through existing checkpoints, without rerunning or deleting neutral reading caches",async()=>{
 const {session,raw}=fixture(),{ai,calls,raw:transport}=provider(crypto.randomUUID()),db=await getDatabase();
 const readingId=crypto.randomUUID();await cacheAIResult({id:readingId,taskType:"extract",inputHash:readingId,providerId:"openai",modelId:"fixture",analysisVersion:1,result:{neutral:"saved initial reading"},createdAt:1,readingConversationIds:["source"]});
 const generate=transport.generateStructured.bind(transport);let count=0;
 transport.generateStructured=async<T,>(request:StructuredAIRequest<T>)=>{if(++count===3)throw Error("offline");return generate(request);};
 await expect(reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal)).rejects.toThrow("offline");
 const completed=calls.length;expect(completed).toBe(2);
 const result=await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);
 expect(result.wikiRevisionReceipt?.cachedBatches).toBe(completed);expect(calls.length).toBe(result.wikiRevisionReceipt!.batches);
 const after=calls.length;const again=await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);
 expect(calls).toHaveLength(after);expect(again.wikiRevisionReceipt?.cachedBatches).toBe(again.wikiRevisionReceipt?.batches);
 expect((await db.get("semanticDecisionCache",readingId))?.result).toEqual({neutral:"saved initial reading"});
},20000);

it("invalidates affected chapter batches for changed sources, roles, instructions or models",async()=>{
 const namespace=crypto.randomUUID(),{session,raw}=fixture(),{ai,calls}=provider(namespace);
 await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);let previous=calls.length;
 for(const [message,instruction] of [[{...raw,content:raw.content+"\n\n新增完整条件。"},""],[{...raw,role:"assistant"},""],[raw,"保留示例"]] as const){
  const result=await reviseWikiChapters(session,["one"],[message],instruction,ai,new AbortController().signal);expect(calls.length).toBeGreaterThan(previous);expect(result.wikiRevisionReceipt?.cachedBatches).toBe(0);previous=calls.length;
 }
 const other=provider(namespace,"other-model");const changed=await reviseWikiChapters(session,["one"],[raw],"",other.ai,new AbortController().signal);expect(other.calls.length).toBeGreaterThan(0);expect(changed.wikiRevisionReceipt?.cachedBatches).toBe(0);
},20000);

it("retains literal code, tables and lead-ins as indivisible units, and rejects missing, duplicated or foreign coverage",()=>{
 const text="## 运行条件\n\n只有确认后才能执行下面的代码：\n\n```md\n## literal heading\nrun()\n```\n\n| 条件 | 行为 |\n| --- | --- |\n| 失败 | 保留 |\n\n下一段完整说明。";
 const units=revisionMarkdownUnits(text,"test","draft","主题");expect(units.map(unit=>unit.text).join("")).toBe(text);expect(units.find(unit=>unit.text.includes("run()"))?.text).toContain("只有确认后");
 const {session,raw}=fixture();session.sections[0].body=text;
 const plan=prepareWikiRevisionBatches(session,session.sections[0],[raw],"",provider(crypto.randomUUID()).ai,new AbortController().signal),request=plan.batches[0].request,valid=response(request);
 expect(()=>request.validate(valid)).not.toThrow();
 const missing=structuredClone(valid);missing.blocks.pop();expect(()=>request.validate(missing)).toThrow();
 const duplicate=structuredClone(valid);duplicate.blocks[1].unitIds=[duplicate.blocks[0].unitIds[0]];expect(()=>request.validate(duplicate)).toThrow();
 const invented=structuredClone(valid);invented.blocks[0].unitIds=["unknown"];expect(()=>request.validate(invented)).toThrow();
 const lostCode=structuredClone(valid);const block=lostCode.blocks.find((item:{verbatimUnitIds?:string[]})=>item.verbatimUnitIds?.length)!;block.verbatimUnitIds=[];block.body="代码略去。";expect(()=>request.validate(lostCode)).toThrow();
},20000);

it("rejects quotes outside supplied batch spans, cancellation and indivisible oversized units before publication",async()=>{
 const {session,raw}=fixture(),before=structuredClone(session),{ai,calls}=provider(crypto.randomUUID());
 const plan=prepareWikiRevisionBatches(session,session.sections[0],[raw],"",ai,new AbortController().signal),request=plan.batches[0].request,invalid=response(request);
 invalid.blocks[0].claims=[{text:"虚构",quote:"没有提供的引文",evidenceIds:["e1"]}];expect(()=>request.validate(invalid)).toThrow();
 const controller=new AbortController();controller.abort();await expect(reviseWikiChapters(session,["one"],[raw],"",ai,controller.signal)).rejects.toThrow();expect(calls).toHaveLength(0);
 expect(calls).toHaveLength(0);expect(session).toEqual(before);
},20000);

it("keeps an oversized unit whole and revises the rest instead of failing the chapter",async()=>{
 const {session,raw}=fixture(),{ai,calls}=provider(crypto.randomUUID()),giant="```txt\n"+"不可拆分".repeat(40000)+"\n```";
 const result=await reviseWikiChapters(session,["one"],[{...raw,content:raw.content+"\n\n"+giant}],"",ai,new AbortController().signal);
 expect(calls.length).toBeGreaterThan(0);expect(calls.every(request=>!request.prompt.includes("不可拆分不可拆分不可拆分"))).toBe(true);
 const receipt=result.wikiRevisionReceipt!;expect(receipt.references.filter(item=>/超过一次调整的输入上限/u.test(item.reason))).toHaveLength(1);
 // Nothing revisable at all still fails before any request.
 const alone=structuredClone(session);alone.sections[0].body="不可拆分".repeat(40000);calls.length=0;
 await expect(reviseWikiChapters(alone,["one"],[{...raw,content:giant}],"",ai,new AbortController().signal)).rejects.toThrow(/预算/u);
 expect(calls).toHaveLength(0);
},20000);

it("keeps an oversized draft unit exactly as saved and reports a partial revision",()=>{
 const {session,raw}=fixture(),{ai}=provider(crypto.randomUUID()),huge="完整段落".repeat(40000);
 session.sections[0].body+=`\n\n## 超长\n\n${huge}`;
 const plan=prepareWikiRevisionBatches(session,session.sections[0],[raw],"",ai,new AbortController().signal);
 expect(plan.keptDraftUnits).toBe(1);expect(plan.batches.every(batch=>!batch.request.prompt.includes(huge))).toBe(true);
 const assembled=plan.assemble(plan.batches.map(batch=>batch.request.validate(response(batch.request))));
 expect(assembled.section.body).toContain(`## 超长\n\n${huge}`);
});

it("sizes revision batches by provider-calibrated tokens and passes the scale to the send gate",async()=>{
 const calibration=await import("./token-calibration");calibration.resetTokenCalibration();
 const {session,raw}=fixture(),{ai}=provider(crypto.randomUUID(),"calibrated-model"),signal=new AbortController().signal;
 const before=prepareWikiRevisionBatches(session,session.sections[0],[raw],"",ai,signal).batches.length;
 for(let i=0;i<5;i++)calibration.recordTokenSample("calibrated-model",10000,5000);
 const after=prepareWikiRevisionBatches(session,session.sections[0],[raw],"",ai,signal);
 expect(after.batches.length).toBeLessThan(before);
 for(const {request} of after.batches){expect(request.inputBudgetScale).toBe(0.6);expect(requestBudget(request,"calibrated-model").inputTokens*0.6).toBeLessThanOrEqual(12000);}
 calibration.resetTokenCalibration();
},20000);

it("retains completed batches on cancellation and never publishes an incomplete new version",async()=>{
 const {session,raw}=fixture(),before=structuredClone(session),{ai,calls}=provider(crypto.randomUUID()),cancel=new AbortController();
 await expect(reviseWikiChapters(session,["one"],[raw],"",ai,cancel.signal,done=>{if(done===1)cancel.abort();})).rejects.toThrow();
 expect(calls).toHaveLength(1);expect(session).toEqual(before);
 const result=await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);
 expect(result.wikiRevisionReceipt?.cachedBatches).toBe(1);expect(calls.length).toBe(result.wikiRevisionReceipt?.batches);
},20000);

it("revalidates a corrupted checkpoint, reuses the valid provider cache, and reserves smaller model context",async()=>{
 const {session,raw}=fixture(),{ai,calls}=provider(crypto.randomUUID()),db=await getDatabase();
 await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);const before=calls.length;
 const saved=(await db.getAll("semanticDecisionCache")).find(row=>row.id.includes(":revision-v1:")&&(row.result as {blocks?:unknown[]})?.blocks?.length)!;
 const bad=structuredClone(saved);(bad.result as {blocks:Array<{unitIds:string[]}>}).blocks[0].unitIds=["foreign-unit"];await db.put("semanticDecisionCache",bad);
 const again=await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);expect(calls).toHaveLength(before);expect(again.wikiRevisionReceipt?.cachedBatches).toBe(again.wikiRevisionReceipt?.batches);
 const small={...ai,capabilities:{textGeneration:true as const,structuredOutput:"json" as const,embeddings:false,maxContextTokens:8000}};
 const prepared=prepareWikiRevisionBatches(session,session.sections[0],[raw],"",small,new AbortController().signal);
 for(const {request} of prepared.batches)expect(requestBudget(request,"fixture").inputTokens+request.maxOutputTokens!).toBeLessThanOrEqual(8000);
},20000);

it("keeps the short-chapter request path and reuses its existing model result cache",async()=>{
 const {session,raw}=fixture(),{ai,calls}=provider(crypto.randomUUID());
 session.sections[0].body="只有确认后才保存。";raw.content="只有确认后才保存。";
 await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);
 const again=await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);
 expect(calls).toHaveLength(1);expect(JSON.parse(calls[0].prompt).presentation).toBe("wiki_section_rewrite");expect(again.wikiRevisionReceipt).toBeUndefined();
},20000);

it("records one diagnostics span per AI adjustment with batches, kept units and the failure code",async()=>{
 const {session,raw}=fixture(),{ai}=provider(crypto.randomUUID()),db=await getDatabase(),runId=crypto.randomUUID();
 await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal,undefined,runId);
 const giant="```txt\n"+"不可拆分".repeat(40000)+"\n```",alone=structuredClone(session);alone.sections[0].body="不可拆分".repeat(40000);
 await expect(reviseWikiChapters(alone,["one"],[{...raw,content:giant}],"",ai,new AbortController().signal,undefined,runId)).rejects.toThrow();
 const spans=(await db.get("organizationRuns",runId))!.pipelineSpans!.filter(span=>span.phase==="wiki:revision");
 expect(spans).toHaveLength(2);
 expect(spans[0]).toMatchObject({status:"completed",counts:{chapters:1,kept_draft_units:0}});expect(spans[0].counts!.batches).toBeGreaterThan(1);
 expect(spans[1]).toMatchObject({status:"failed",reason:"WIKI_REWRITE_BUDGET",counts:{chapters:1}});
},20000);
