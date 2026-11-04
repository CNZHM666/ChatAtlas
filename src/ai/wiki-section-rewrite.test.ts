import { expect, it, vi } from "vitest";
import { rewriteWikiSection,prepareWikiRewrite } from "./wiki-section-rewrite";
import { projectSession, projectText } from "../test/project-fixture";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import type { ConversationMessage } from "../shared/types";

const raw: ConversationMessage = { id: "message", conversationId: "source", role: "user", content: projectText, messageIndex: 0, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 };
function provider(value: unknown) {
  const generateStructured = vi.fn(async (request: StructuredAIRequest<unknown>) => request.validate(value));
  return { generateStructured, modelId: "fixture", id: "fixture" } as unknown as AtlasAIProvider & {generateStructured: typeof generateStructured};
}
const output = { body: "先验证核心流程，再扩展功能。", claims: [{ text: "先验证核心流程", quote: "先验证核心流程", evidenceIds: ["e1"] }] };

it("edits a generated rewrite title against the whole document's reserved names without changing unselected pages",async()=>{
 const session=projectSession();session.sections.push({...session.sections[0],id:"mine",title:"保存机制",userEdited:true,body:"私人正文不得发送"});
 const before=structuredClone(session),requests:StructuredAIRequest<unknown>[]=[];
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  requests.push(request as StructuredAIRequest<unknown>);const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_title_edit")return request.validate({titles:[{id:"c:0",title:"保存机制"}]});
  return request.validate({...output,title:"规则与校验"});
 }} as AtlasAIProvider;
 const result=await rewriteWikiSection(session,session.sections[0],[raw],"",ai,new AbortController().signal);
 expect(requests).toHaveLength(2);expect(result.title).toBe("规则与校验");expect(result.body).toBe(output.body);
 expect(result.wikiTitleReview?.status).toBe("failed");expect(JSON.stringify(requests)).not.toContain("私人正文不得发送");expect(session).toEqual(before);
});

it("sends only the selected chapter's bound originals once and returns a candidate without mutation", async () => {
  const session = projectSession(), before = structuredClone(session), ai = provider(output);
  const result = await rewriteWikiSection(session, session.sections[0], [raw, { ...raw, id: "private", content: "Private unrelated conversation" }], "保留细节", ai, new AbortController().signal);
  expect(ai.generateStructured).toHaveBeenCalledOnce();
  const payload = JSON.parse(ai.generateStructured.mock.calls[0][0].prompt);
  const request=ai.generateStructured.mock.calls[0][0];
  expect(request.maxAttempts).toBe(1);expect(request.system).toContain("Article depth v7");expect(request.system).toContain("a checklist of proposed acceptance criteria is not a test result");expect(payload.version).toBe(8);
  expect(request.system).toContain("subject AND operating mode");expect(request.system).toContain("Neither wording alone proves replacement");expect(request.system).toContain("retaining the union of supported details");
  expect(payload.originalPassages).toHaveLength(1); expect(JSON.stringify(payload)).not.toContain("Private unrelated");
  expect(payload.editorialRequest).toBe("保留细节");
  expect(payload.projectBoundary.project.name).toBe(session.title);
  expect(result.id).toBe(session.sections[0].id); expect(result.body).toBe(output.body);
  expect(result.claims![0].verification).toBeUndefined(); expect(result.evidenceReview?.mode).toBe("manual");
  expect(session).toEqual(before);
});

it("carries paragraph routing into a rewrite that reads the full mixed original",()=>{
 const session=projectSession(),other="另一个项目的知识演进建议。";
 session.evidence.push({...session.evidence[0],id:"excluded-fragment"});
 session.wikiScopeReview={version:1,goal:session.goal,includeKeys:[],materials:[{id:"other",key:"other-key",title:"旁支",body:other,evidenceIds:["excluded-fragment"],kind:"other",quote:other,reason:"属于另一个项目"}]};
 const before=structuredClone(session),request=prepareWikiRewrite(session,session.sections[0],[{...raw,content:raw.content+"\n\n"+other}],"整理正文",provider(output),new AbortController().signal),data=JSON.parse(request.prompt);
 expect(data.sourceRouting).toEqual([{kind:"other",quote:other,reason:"属于另一个项目",content:other}]);
 expect(data.originalPassages[0].text).toContain(other);expect(data.projectBoundary.project.name).toBe(session.title);expect(session).toEqual(before);
});

it.each([
  { ...output, claims: [{ ...output.claims[0], evidenceIds: ["invented"] }] },
  { ...output, claims: [{ ...output.claims[0], quote: "Never said this" }] },
])("rejects fabricated IDs and quotes while keeping the original", async value => {
  const session = projectSession(), before = structuredClone(session);
  await expect(rewriteWikiSection(session, session.sections[0], [raw], "", provider(value), new AbortController().signal)).rejects.toThrow();
  expect(session).toEqual(before);
});

it("protects personal prose, missing sources, and oversize inputs before sending any request", async () => {
  const session = projectSession(), ai = provider(output), signal = new AbortController().signal;
  await expect(rewriteWikiSection(session, { ...session.sections[0], userEdited: true }, [raw], "", ai, signal)).rejects.toThrow();
  await expect(rewriteWikiSection(session, session.sections[0], [], "", ai, signal)).rejects.toThrow();
  // A long original alone is kept as a source reference; with no revisable draft either, nothing is sent.
  await expect(rewriteWikiSection(session, { ...session.sections[0], body: "Very long draft. ".repeat(20000) }, [{ ...raw, content: "Very long original. ".repeat(20000) }], "", ai, signal)).rejects.toThrow(/预算|budget/u);
  expect(()=>prepareWikiRewrite(session,session.sections[0],[{...raw,content:"Long original. ".repeat(20000)}],"",ai,signal)).toThrow(expect.objectContaining({code:"WIKI_REWRITE_BUDGET",sectionId:session.sections[0].id,maxInputTokens:8000,sourceMessages:1}));
  expect(ai.generateStructured).not.toHaveBeenCalled();
});
it("retains personal diagram edits and their previous basis when replacing generated prose", async () => {
  const session=projectSession(), section={...session.sections[0],structureEdited:true,semanticStructure:{nodes:[],relations:[]},semanticBodySignature:"previous body",personalExplanation:"My explanation"};
  const result=await rewriteWikiSection(session,section,[raw],"",provider(output),new AbortController().signal);
  expect(result.body).toBe(output.body);
  expect(result.semanticStructure).toEqual(section.semanticStructure);
  expect(result.semanticBodySignature).toBe("previous body");
  expect(result.personalExplanation).toBe("My explanation");
});

it("requires complete planned topic coverage and saves cleaned article text, rather than display-only cleanup",()=>{
 const session=projectSession(),ai=provider(output),plan={topicIds:["t0","t1"],outline:["机制","边界"],owners:[{id:"one",title:"核心流程",topics:["机制","边界"]}]};
 const request=prepareWikiRewrite(session,session.sections[0],[raw],"",ai,new AbortController().signal,plan);
 const value={...output,coveredTopicIds:["t0","t1"],body:"## 机制\n\n先验证核心流程。\n\n## 边界\n\n随后扩展功能。\n\nTransition to next section."};
 expect(request.validate(value).body).not.toContain("Transition to next section");
 expect(()=>request.validate({...value,coveredTopicIds:["t0"]})).toThrow("遗漏");expect(()=>request.validate({...value,body:"只留下摘要。"})).toThrow("内容归属");expect(session.sections[0].body).toBe(projectText);
});
