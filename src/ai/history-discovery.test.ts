import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { recommendHistory } from "./history-discovery";
import type { AtlasAIProvider } from "./provider";
import { getDatabase } from "../storage/db";
import { requestBudget } from "./request-policy";
import type { Conversation } from "../shared/types";
import { createAtlasAIFromProvider } from "./atlas-ai";
const conversations = ["one", "two"].map(id => ({ id, title: `${id} 硬件项目`, platform: "chatgpt", url: `https://chatgpt.com/c/${id}`, updatedAt: 1, messageCount: 1 }));
beforeEach(async()=>{const db=await getDatabase();await db.clear("messages");await db.clear("semanticDecisionCache");});
async function readySources(count=2): Promise<Conversation[]> {
  const db=await getDatabase(),sources:Conversation[]=Array.from({length:count},(_,index)=>({id:`ready-${index}`,title:"ChatAtlas 数据库项目",platform:"chatgpt",url:"",updatedAt:1,messageCount:1,importState:"complete",hydrationState:"hydrated"}));
  for(const source of sources)await db.put("messages",{id:`${source.id}-message`,conversationId:source.id,messageIndex:0,role:"user",content:"ChatAtlas 数据库项目使用 IndexedDB 保存消息。",preview:"",contentHash:"",createdAt:1,updatedAt:1});
  return sources;
}
const group=(ids:string[],title="ChatAtlas 数据库")=>({title,kind:"project",sourceIds:ids,reason:"标题候选"});
const matches=(data:{sources:Array<{id:string}>})=>({matches:data.sources.map(source=>({sourceId:source.id,quote:"ChatAtlas 数据库项目使用 IndexedDB 保存消息。",reason:"同一数据库项目"}))});
it("does not publish title-only groups as analyzed recommendations", async () => {
  const generateStructured = vi.fn(async request => request.validate({ candidates: [{ title: "硬件平台", kind: "project", sourceIds: ["source-1", "source-2"], reason: "共同讨论平台开发" }] }));
  const result = await recommendHistory({ generateStructured } as unknown as AtlasAIProvider, conversations, [], true);
  expect(result).toEqual([]);
  const prompt = JSON.parse(generateStructured.mock.calls[0][0].prompt);
  expect(prompt.coverage).toBe("titles_and_saved_summaries"); expect(prompt.sources).toHaveLength(2); expect(prompt.sources[0]).not.toHaveProperty("messages");
});
it("sends the user's goal to topic discovery instead of silently discovering every subject",async()=>{
 const generateStructured=vi.fn(async request=>request.validate({candidates:[]}));
 await recommendHistory({generateStructured} as unknown as AtlasAIProvider,conversations,[],true,undefined,undefined,"发现可以继续的硬件项目");
 const data=JSON.parse(generateStructured.mock.calls[0][0].prompt);expect(data.goal).toBe("发现可以继续的硬件项目");expect(data.instruction).toContain("Do not broaden");
});
it("rejects invented sources, empty reasons and single-source groups", async () => {
  for (const candidate of [
    { title: "项目", kind: "project", sourceIds: ["source-1", "invented"], reason: "相关" },
    { title: "项目", kind: "project", sourceIds: ["source-1", "source-1"], reason: "相关" },
    { title: "项目", kind: "project", sourceIds: ["source-1", "source-2"], reason: "" },
  ]) {
    const provider = { generateStructured: async (request: { validate: (value: unknown) => unknown }) => request.validate({ candidates: [candidate] }) } as unknown as AtlasAIProvider;
    await expect(recommendHistory(provider, conversations, [], true)).rejects.toThrow();
  }
});
it("verifies candidate membership from original question-answer excerpts and removes incidental matches", async () => {
  const db = await getDatabase(); await db.clear("messages");
  const sources = ["course", "practice", "polishing"].map(id => ({ id, title: "自动化学习", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 2, importState: "complete" as const, hydrationState: "hydrated" as const }));
  for (const source of sources) for (const [index, content] of [source.id === "polishing" ? "润色自动化文章" : "自动化专业怎么学习控制理论？", source.id === "polishing" ? "修改字数" : "先学习反馈，再做控制实验。"].entries()) await db.put("messages", { id: `${source.id}-${index}`, conversationId: source.id, messageIndex: index, role: index ? "assistant" : "user", content, contentHash: "", preview: "", createdAt: 1, updatedAt: 1 });
  const generateStructured = vi.fn(async request => JSON.parse(request.prompt).presentation === "history_discovery" ? request.validate({ candidates: [{ title: "自动化学习", kind: "review", sourceIds: ["source-1", "source-2", "source-3"], reason: "学习路线" }] }) : request.validate({ matches:[{sourceId:"course",quote:"自动化专业怎么学习控制理论？",reason:"控制理论学习"},{sourceId:"practice",quote:"先学习反馈，再做控制实验。",reason:"控制理论练习"}] }));
  const result = await recommendHistory({ generateStructured } as unknown as AtlasAIProvider, sources, [], true);
  expect(result[0].sourceIds).toEqual(["course", "practice"]); expect(result[0].basis).toBe("recommendation");
  const request = generateStructured.mock.calls[1][0]; expect(request.prompt).toContain("先学习反馈"); expect(requestBudget(request, "").inputTokens).toBeLessThanOrEqual(4000);
});
it("rejects model approval without a literal original quote",async()=>{
  const sources=await readySources(),progress=vi.fn();
  const provider={generateStructured:vi.fn(async request=>{const data=JSON.parse(request.prompt);return request.validate(data.presentation==="history_discovery"?{candidates:[group(["source-1","source-2"])]}:{matches:[{sourceId:"source-1",quote:"模型编造的相似依据",reason:"相关"},{sourceId:"source-2",quote:"模型编造的相似依据",reason:"相关"}]});})} as unknown as AtlasAIProvider;
  expect(await recommendHistory(provider,sources,[],true,undefined,progress)).toEqual([]);
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({failedGroups:1,candidates:[]}));
});
it("does not publish a recommendation when source content changes during verification",async()=>{
  const sources=await readySources(),db=await getDatabase();
  const provider={generateStructured:vi.fn(async request=>{const data=JSON.parse(request.prompt);if(data.presentation==="history_discovery")return request.validate({candidates:[group(["source-1","source-2"])]});const result=request.validate(matches(data));const message=await db.get("messages","ready-0-message");await db.put("messages",{...message!,content:"这条消息已经被修改。"});return result;})} as unknown as AtlasAIProvider;
  expect(await recommendHistory(provider,sources,[],true)).toEqual([]);
});
it("publishes completed groups progressively with bounded concurrent verification",async()=>{
  const sources=await readySources(6),pending:Array<()=>void>=[],progress=vi.fn();let active=0,maxActive=0;
  const provider={capabilities:{maxConcurrency:2},generateStructured:vi.fn(async request=>{const data=JSON.parse(request.prompt);if(data.presentation==="history_discovery")return request.validate({candidates:[group(["source-1","source-2"],"数据库一"),group(["source-3","source-4"],"数据库二"),group(["source-5","source-6"],"数据库三")]});active++;maxActive=Math.max(maxActive,active);await new Promise<void>(resolve=>pending.push(resolve));active--;return request.validate(matches(data));})} as unknown as AtlasAIProvider;
  const result=recommendHistory(provider,sources,[],true,undefined,progress);
  await vi.waitFor(()=>expect(pending).toHaveLength(2));
  pending.shift()!();
  await vi.waitFor(()=>expect(progress.mock.calls.some(([state])=>state.candidates.length===1)).toBe(true));
  await vi.waitFor(()=>expect(pending).toHaveLength(2));
  pending.splice(0).forEach(resolve=>resolve());
  expect(await result).toHaveLength(3);expect(maxActive).toBe(2);
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({done:3,total:3,failedGroups:0}));
});
it("keeps a valid group when another verification fails",async()=>{
  const sources=await readySources(4),progress=vi.fn();
  const provider={generateStructured:vi.fn(async request=>{const data=JSON.parse(request.prompt);if(data.presentation==="history_discovery")return request.validate({candidates:[group(["source-1","source-2"],"数据库一"),group(["source-3","source-4"],"数据库二")]});if(data.topic==="数据库一")throw Error("provider failed");return request.validate(matches(data));})} as unknown as AtlasAIProvider;
  const result=await recommendHistory(provider,sources,[],true,undefined,progress);
  expect(result.map(item=>item.title)).toEqual(["数据库二"]);expect(result[0].reason).toBe("同一数据库项目");
  expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({failedGroups:1}));
});
it("reuses existing AI request caches and invalidates verification after an unseen message edit",async()=>{
  const sources=await readySources(),db=await getDatabase();
  await db.put("messages",{id:"extra",conversationId:sources[0].id,messageIndex:1,role:"assistant",content:"补充正文。",preview:"",contentHash:"",createdAt:1,updatedAt:1});
  const generateStructured=vi.fn(async request=>{const data=JSON.parse(request.prompt);return request.validate(data.presentation==="history_discovery"?{candidates:[group(["source-1","source-2"])]}:matches(data));});
  const ai=createAtlasAIFromProvider({id:"fixture",modelId:"fixture",generateStructured} as unknown as AtlasAIProvider,{id:"ai-settings",updatedAt:1,provider:"openai",baseUrl:"https://fixture.example/v1",apiKey:"fixture",model:"fixture"},new AbortController().signal);
  expect(await recommendHistory(ai,sources,[],true)).toHaveLength(1);expect(generateStructured).toHaveBeenCalledTimes(2);
  expect(await recommendHistory(ai,sources,[],true)).toHaveLength(1);expect(generateStructured).toHaveBeenCalledTimes(2);
  const extra=await db.get("messages","extra");await db.put("messages",{...extra!,content:"更新补充正文。"});
  expect(await recommendHistory(ai,sources,[],true)).toHaveLength(1);expect(generateStructured).toHaveBeenCalledTimes(3);
});
