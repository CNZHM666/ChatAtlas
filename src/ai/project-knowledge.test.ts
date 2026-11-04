import { expect, it, vi } from "vitest";
import { readProjectKnowledge, resolveProjectProofs, reusableProjectKnowledge, reusableWikiNavigation, reusableProjectState, projectKnowledgeSignature, projectKnowledgeScopeSignature } from "./project-knowledge";
import { projectProofBlocks } from "../shared/atlas/project-knowledge.js";
import { projectSession } from "../test/project-fixture";
import { sourceMessageSignature } from "../shared/source-signature";
import type { AtlasAI } from "./atlas-ai";
import type { StructuredAIRequest } from "./provider";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { ProjectOriginalSource } from "./project-sources";
import { projectStateSignature } from "../shared/project-state";
it("reuses an unchanged stamped batch after another message changes and rejects altered provenance",()=>{
 const session=reusableSession(),second={...original,id:"e2",messageId:"other",messageIndex:1,text:"我决定使用 Orama 搜索消息。",signature:sourceMessageSignature("我决定使用 Orama 搜索消息。")};
 session.evidence.push({...session.evidence[0],id:"e2",messageId:"other",excerpt:second.text});session.sourceSignatures!.source.other=second.signature;session.sourceRoles!.source.other="user";session.sourceMessageOrder!.source.push("other");
 const first=session.projectKnowledge!.batches[0];first.sources=[original];first.scopeSignature=projectKnowledgeScopeSignature(session);session.projectKnowledge!.signature=projectKnowledgeSignature(session);
 session.projectKnowledge!.batches.push({sourceIds:["e2"],sources:[second],scopeSignature:projectKnowledgeScopeSignature(session),facts:readProjectKnowledge({...facts,history:[],modules:[{...facts.modules[0],id:"module:search",quoteKey:"e2:1"}]},[{id:"e2",text:second.text,role:"user"}])});
 session.sourceSignatures!.source.other="changed";
 const result=reusableProjectKnowledge(session,[original,{...second,signature:"changed",text:"不同原文"}])!;
 expect(result[0].facts?.modules).toHaveLength(1);expect(result[1].facts).toBeUndefined();
 for(const changed of [{...original,role:"assistant"},{...original,messageIndex:2},{...original,discussedAt:1}])expect(reusableProjectKnowledge(session,[changed,{...second,signature:"changed"}])?.[0].facts).toBeUndefined();
 expect(reusableProjectKnowledge({...session,goal:"另一产品"},[original,second])?.[0].facts).toBeUndefined();
});

const content = "我决定使用 IndexedDB 保存消息。";
const facts = { summary: "本地消息存储", modules: [{ id: "module:db", title: "消息存储", layer: "数据", purpose: "保存消息", inputs: [], outputs: [], status: "documented", quoteKey: "e1:1" }], relations: [], decisions: [], constraints: [], history: [{ id: "history:db", title: "采用 IndexedDB", area: "数据库", changeKind: "adopt", decisionStatus: "confirmed", version: "", before: "", after: "使用 IndexedDB 保存消息", reason: "", status: "documented", quoteKey: "e1:1" }] };
const original: ProjectOriginalSource = { id: "e1", conversationId: "source", messageId: "message", role: "user", messageIndex: 0, discussedAt: Date.UTC(2026,8,1), signature: sourceMessageSignature(content), text: content, partial: false };
function reusableSession(text = content) {
  const session = projectSession();
  session.evidence[0] = { ...session.evidence[0], conversationId: "source", messageId: "message", excerpt: content };
  session.projectState = undefined; session.sourceSignatures = { source: { message: sourceMessageSignature(text) } }; session.sourceRoles = { source: { message: "user" } }; session.sourceMessageOrder = { source: ["message"] };
  session.projectKnowledge = { version: 1, signature: projectKnowledgeSignature(session), batches: [{ sourceIds: ["e1"], facts: readProjectKnowledge(facts, [{ id: "e1", text, role: "user" }]) }] };
  return session;
}
it("copies proof ranges exactly and rejects invented, nonadjacent and overlong selections", () => {
  const text = "第一句。\n" + "细节".repeat(400) + "。🙂结束";
  const blocks = projectProofBlocks(text); expect(blocks.map(block => block.text).join("")).toBe(text);
  expect(resolveProjectProofs({ quoteKey: "e1:1" }, [{ id:"e1", text:content }])).toMatchObject({ quote:content, evidenceIds:["e1"] });
  expect(resolveProjectProofs({ quoteKey: "invented:1" }, [{ id:"e1", text }])).not.toHaveProperty("quote");
  expect(resolveProjectProofs({ quoteKeys: ["e1:1", "e1:3"] }, [{ id:"e1", text }])).not.toHaveProperty("quote");
  expect(resolveProjectProofs({ quoteKeys: ["e1:2", "e1:3"] }, [{ id:"e1", text }])).not.toHaveProperty("quote");
});
it("only original user evidence can confirm a first-reading choice", () => {
  expect(readProjectKnowledge(facts, [{ id:"e1", text:content, role:"user" }])?.history?.[0].decisionStatus).toBe("confirmed");
  const result = readProjectKnowledge(facts, [{ id:"e1", text:content, role:"assistant" }]);
  expect(result?.history).toEqual([]); expect(result?.reviewNotes?.length).toBeGreaterThan(0);
  expect(readProjectKnowledge({ modules:[] }, [{ id:"e1", text:content }])).toBeUndefined();
});
it("reuses valid facts and invalidates changed source content, roles, scope and legacy format", () => {
  const session = reusableSession(); expect(reusableProjectKnowledge(session, [original])?.[0].facts?.modules).toHaveLength(1);
  expect(reusableProjectKnowledge(session, [{...original, signature:"changed"}])?.[0].facts).toBeUndefined();
  expect(reusableProjectKnowledge(session, [{...original, role:"assistant"}])?.[0].facts).toBeUndefined();
  expect(reusableProjectKnowledge({...session, sourceMessageOrder:{source:["new","message"]}}, [original])).toBeUndefined();
  expect(reusableProjectKnowledge({...session, scope:{kind:"goal",blocks:[]}}, [original])).toBeUndefined();
  expect(reusableProjectKnowledge({...session, projectKnowledge:undefined}, [original])).toBeUndefined();
  expect(reusableProjectKnowledge(session, [])?.[0].facts).toBeUndefined();
});
it("captures optional facts during the same full reading and tolerates older servers without facts", async () => {
  const source:Conversation={id:"source",title:"数据库",platform:"chatgpt",url:"",messageCount:1,updatedAt:1};
  const message:ConversationMessage={id:"message",conversationId:"source",messageIndex:0,role:"user",content,preview:"",contentHash:"",createdAt:1,updatedAt:1};
  const synthesize=vi.fn(async<T>(request:StructuredAIRequest<T>):Promise<T>=>{const data=JSON.parse(request.prompt), id=data.passages[0].id;return request.validate({ title:"数据库", sections:[{title:"数据库",body:content,transition:"",kind:"review",evidenceIds:[id]}], ...(!data.coverage.final?{projectFacts:JSON.parse(JSON.stringify(facts).replaceAll("e1:1",`${id}:1`))}:{}) });});
  const result=await synthesizeCoveredFocus({goal:"创建项目",mode:"work",locale:"zh-CN",sources:[source],passages:transcriptPassages(source,[message]),collectProjectKnowledge:true,ai:{synthesize:synthesize as AtlasAI["synthesize"],canReuseProjectKnowledge:true},signal:new AbortController().signal,validate:validateFocusResult});
  expect(synthesize).toHaveBeenCalledTimes(2); expect(JSON.parse(synthesize.mock.calls[0][0].prompt).projectKnowledge).toBe(true);
  expect(result.knowledgeBatches?.[0].facts?.modules[0].quote).toBe(content);
  expect(result.knowledgeBatches?.[0].sourceIds).toEqual(result.evidence.map(ref=>ref.id));
  const legacy=await synthesizeCoveredFocus({goal:"创建项目",mode:"work",locale:"zh-CN",sources:[source],passages:transcriptPassages(source,[message]),ai:{synthesize:synthesize as AtlasAI["synthesize"],canReuseProjectKnowledge:false},signal:new AbortController().signal,validate:validateFocusResult});
  expect(legacy.knowledgeBatches).toBeUndefined();
});
it("keeps already-paid cached facts without requesting them during a new lightweight reading",async()=>{
  const source:Conversation={id:"paid-facts-source",title:"数据库",platform:"chatgpt",url:"",messageCount:1,updatedAt:1};
  const text=content+"\n\n"+"这是历史背景，不代表新增架构。".repeat(250);
  const message:ConversationMessage={id:"paid-message",conversationId:source.id,messageIndex:0,role:"user",content:text,preview:"",contentHash:"",createdAt:1,updatedAt:1};
  const synthesize=vi.fn(async<T>(request:StructuredAIRequest<T>):Promise<T>=>{
    const data=JSON.parse(request.prompt),id=data.passages[0].id;
    if(!data.coverage.final)expect(data.projectKnowledge).toBe(true);
    return request.validate({title:"数据库",sections:[{title:"数据库",body:content,transition:"",kind:"review",evidenceIds:[id]}],...(!data.coverage.final?{projectFacts:{...facts,history:[],modules:[{...facts.modules[0],quoteKey:undefined,quote:content,evidenceIds:[id]}]}}:{})});
  });
  const cached=vi.fn(async(request:{prompt:string})=>Boolean(JSON.parse(request.prompt).projectKnowledge));
  const result=await synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources:[source],passages:transcriptPassages(source,[message]),ai:{synthesize:synthesize as AtlasAI["synthesize"],canReuseProjectKnowledge:true,hasCachedSynthesis:cached},signal:new AbortController().signal,validate:validateFocusResult});
  expect(result.knowledgeBatches?.[0].facts?.modules[0].quote).toBe(content);expect(cached).toHaveBeenCalled();
  expect(JSON.parse(synthesize.mock.calls.at(-1)![0].prompt).projectKnowledge).toBeUndefined();
});

it.each(["edited", "stale", "unverified", "uncertain"])("does not use %s Wiki prose as reviewed navigation", change => {
  const session = reusableSession();
  session.sections[0] = { ...session.sections[0], evidenceIds: ["e1"], claims: [{ text: "存储要点", quote: content, evidenceIds: ["e1"], verification: "supported" }], evidenceReview: { status: "verified", invalidClaims: 0, checkedClaims: 1, totalClaims: 1 } };
  if (change === "edited") session.sections[0].userEdited = true;
  if (change === "stale") session.sourceSignatures!.source.message = "changed";
  if (change === "unverified") session.sections[0].evidenceReview!.status = "partial";
  if (change === "uncertain") session.sections[0].claims![0].verification = "uncertain";
  expect(reusableWikiNavigation(session, [original])).toEqual([]);
});

it("reuses a complete verified project state only while its scope, roles, positions and original text match", () => {
  const session = projectSession(), source = { ...original, role: "assistant" as const, text: session.evidence[0].excerpt, signature: sourceMessageSignature(session.evidence[0].excerpt) };
  const state = session.projectState!;
  state.verification = "original"; state.sources = [{ ...source }]; state.signature = projectStateSignature(session);
  expect(reusableProjectState(session, [source], "architecture")).toBe(state);
  for (const changed of [{ ...source, signature: "changed" }, { ...source, role: "user" as const }, { ...source, messageIndex: 99 }, { ...source, discussedAt: 1 }]) expect(reusableProjectState(session, [changed], "architecture")).toBeUndefined();
  expect(reusableProjectState({ ...session, goal: "新目标" }, [source], "architecture")).toBeUndefined();
  state.reviewNotes = [{ key: "pending", category: "source_batch", reason: "仍有未完成材料" }];
  expect(reusableProjectState(session, [source], "architecture")).toBeUndefined();
});
it("keeps real message identity so a later user confirmation in the same conversation survives reading", () => {
  const proposal = "我建议采用 Orama 作为搜索引擎。", approval = "我确认采用 Orama 作为搜索引擎。";
  const wire = { summary: "搜索", modules: [], relations: [], decisions: [], constraints: [], history: [{ id: "history:search", title: "采用 Orama", area: "搜索", changeKind: "adopt", decisionStatus: "confirmed", version: "", before: "", after: "采用 Orama 作为搜索引擎", reason: "", status: "documented", quoteKey: "e1:1", confirmationQuoteKey: "e2:1" }] };
  const sources = [{ id: "e1", text: proposal, role: "assistant", conversationId: "c1", messageId: "m1", messageIndex: 0 }, { id: "e2", text: approval, role: "user", conversationId: "c1", messageId: "m2", messageIndex: 1 }];
  const read = readProjectKnowledge(wire, sources);
  expect(read?.history).toHaveLength(1); expect(read?.history?.[0].decisionStatus).toBe("confirmed"); expect(read?.reviewNotes).toBeUndefined();
  // Without real identity, slice IDs never fabricate a shared conversation.
  expect(readProjectKnowledge(wire, sources.map(({ id, text, role }) => ({ id, text, role })))?.history ?? []).toHaveLength(0);
  // The same wording in another conversation does not confirm the proposal.
  expect(readProjectKnowledge(wire, [sources[0], { ...sources[1], conversationId: "c2" }])?.history ?? []).toHaveLength(0);
});
it("keeps the model's relation pointer through reading and cache revalidation, dropping malformed ones",()=>{
  const text="我决定取消独立的 Context Pack 入口，改为导出 Wiki。",sources=[{id:"e1",text,role:"user",conversationId:"c1",messageId:"m1",messageIndex:0}];
  const wire=(relation:unknown)=>({summary:"导出",modules:[],relations:[],decisions:[],constraints:[],history:[{id:"history:export",title:"改为导出 Wiki",area:"导出",changeKind:"change",decisionStatus:"confirmed",version:"",before:"",after:"导出 Wiki",reason:"",status:"documented",quoteKey:"e1:1",relation}]});
  const read=readProjectKnowledge(wire({kind:"replaces",target:"",hint:"独立的 Context Pack 入口"}),sources);
  expect(read?.history?.[0].pendingRelation).toEqual({kind:"replaces",hint:"独立的 Context Pack 入口"});
  expect(readProjectKnowledge(read,sources)?.history?.[0].pendingRelation).toEqual(read?.history?.[0].pendingRelation);
  const loose=readProjectKnowledge(wire({kind:"",target:"",hint:""}),sources);
  expect(loose?.history).toHaveLength(1);expect(loose?.history?.[0].pendingRelation).toBeUndefined();
});
