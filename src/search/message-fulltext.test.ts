import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { ConversationMessage } from "../shared/types";
import { MESSAGE_SEARCH_VERSION, MessageFullTextSearch, messageSearchTokens } from "./message-fulltext";

const message = (id: string, content: string, conversationId = "c", time = 10): ConversationMessage => ({ id, conversationId, content, preview: content, contentHash: "unchanged-external-hash", role: "assistant", messageIndex: Number(id.replace(/\D/gu,"")) || 0, createdAt: time, updatedAt: time });
beforeEach(async () => { const db = await getDatabase(); for (const name of ["messages", "conversations", "messageSearchDocuments", "messageSearchManifests", "messageSearchState"] as const) await db.clear(name); await db.put("conversations", { id: "c", title: "技术讨论", platform: "chatgpt", url: "https://chatgpt.com/c/c", updatedAt: 1, messageCount: 0 }); });
it("tokenizes Chinese substrings, English, intact function names and mixed code", async () => {
  expect(messageSearchTokens("电气验证 buildContext GPIO_pin")).toEqual(expect.arrayContaining(["电气","气验","验证","buildcontext","build","context","gpio_pin","gpio","pin"]));
  const db = await getDatabase();
  for (const [id, body] of [["chinese", "建立完善的电气验证体系，约束跨模块协作。"], ["code", "async function buildContext(request: ContextRequest) { return GPIO_pin; }"], ["mixed", "使用 React 实现上下文管理与 BYOK 模型适配"], ["noise", "电路图与天气"]]) await db.put("messages", message(id, body));
  const engine = new MessageFullTextSearch();
  for (const [query, expected] of [["电气验证", "chinese"], ["buildContext", "code"], ["buildcontext", "code"], ["GPIO_pin", "code"], ["上下文 React", "mixed"]]) expect((await engine.search(query)).hits.map(hit => hit.messageId)).toContain(expected);
  expect((await engine.search("电气验证")).hits.map(hit => hit.messageId)).not.toContain("noise");
});
it("filters platform, exact conversation IDs and message timestamps", async () => {
  const db = await getDatabase(); await db.put("conversations", { id: "d", title: "Claude", platform: "claude", url: "https://claude.ai/chat/d", updatedAt: 1, messageCount: 1 });
  await db.put("messages", message("m1", "shared context", "c", 10)); await db.put("messages", message("m2", "shared context", "d", 20));
  const engine = new MessageFullTextSearch();
  expect((await engine.search("context", { platforms: ["claude"], from: 15, to: 25 })).hits.map(hit=>hit.messageId)).toEqual(["m2"]);
  expect((await engine.search("context", { conversationIds: ["c"] })).hits.map(hit=>hit.messageId)).toEqual(["m1"]);
  expect((await engine.search("context", { conversationIds: [] })).hits).toEqual([]);
});
it("provides all matching conversations with one precise message per conversation", async () => {
  const db = await getDatabase();
  for (let i = 0; i < 105; i++) { const id = `c${i}`; await db.put("conversations", { id, title: id, platform: "claude", url: "", updatedAt: 1, messageCount: 2 }); for (let n = 0; n < 2; n++) await db.put("messages", message(`${id}:${n}`, "libraryKeyword", id)); }
  const results = await new MessageFullTextSearch().searchConversations("libraryKeyword"); expect(results.hits).toHaveLength(105); expect(new Set(results.hits.map(hit => hit.conversationId)).size).toBe(105); expect(results.hits.every(hit => hit.message.conversationId === hit.conversationId)).toBe(true);
});
it("indexes the end of very long messages and aggregates overlapping chunks", async () => {
  const db = await getDatabase(), body = `${"ordinary material ".repeat(6000)}电气验证体系 tailFunctionName`;
  await db.put("messages", message("long",body)); await db.put("messages", message("blank","  \n "));
  const engine = new MessageFullTextSearch(), result = await engine.search("tailFunctionName");
  expect(result.hits).toHaveLength(1); expect(result.hits[0]).toMatchObject({ messageId: "long", conversationId: "c" }); expect(result.hits[0].sourceRange.start).toBeGreaterThan(90000); expect(result.hits[0].summary).toContain("tailFunctionName");
  expect((await engine.search("ordinary")).hits).toHaveLength(1); expect((await db.get("messages","long"))?.content).toBe(body); expect((await engine.status()).indexedMessages).toBe(1);
});
it("incrementally rereads IDs for append, edits, deletion and duplicate synchronization", async () => {
  const db=await getDatabase(), engine=new MessageFullTextSearch(); await db.put("messages",message("one","oldCondition")); await engine.prepare();
  await db.put("messages",message("one","newCondition")); await db.put("messages",message("two","newCondition")); await engine.updateMessages(["one","two","two"]);
  expect((await engine.search("oldCondition")).hits).toHaveLength(0); expect((await engine.search("newCondition")).hits).toHaveLength(2);
  const count=await db.count("messageSearchDocuments"); await engine.updateMessages(["one","two"]); expect(await db.count("messageSearchDocuments")).toBe(count);
  await db.delete("messages","one"); await engine.updateMessages(["one"]); expect((await engine.search("newCondition")).hits.map(hit=>hit.messageId)).toEqual(["two"]);
});
it("does not leak a relocated message through the previous conversation filter", async () => {
  const db = await getDatabase(), engine = new MessageFullTextSearch();
  await db.put("conversations", { ...(await db.get("conversations", "c"))!, id: "d" });
  await db.put("messages", message("moved", "scopeKeyword", "c")); await engine.prepare();
  await db.put("messages", message("moved", "scopeKeyword", "d"));
  expect((await engine.search("scopeKeyword", { conversationIds: ["c"] })).hits).toEqual([]);
  await engine.updateMessages(["moved"]);
  expect((await engine.search("scopeKeyword", { conversationIds: ["d"] })).hits.map(hit => hit.conversationId)).toEqual(["d"]);
});
it("recovers missed events on restart and checks persistent conversation revisions", async () => {
  const db=await getDatabase(); await db.put("messages",message("one","original")); const engine=new MessageFullTextSearch(); await engine.prepare();
  await db.put("messages",message("one","revised")); await db.put("conversations",{ ...(await db.get("conversations","c"))!, rawRevision:"new",updatedAt:2 });
  expect((await engine.search("revised")).hits).toHaveLength(1);
  await db.put("messages",message("missed","newlyArrived")); expect((await new MessageFullTextSearch().search("newlyArrived")).hits).toHaveLength(1);
  await db.delete("messages","missed"); expect((await new MessageFullTextSearch().search("newlyArrived")).hits).toHaveLength(0);
});
it("retains the active generation on interrupted rebuild and resumes its checkpoint", async () => {
  const db=await getDatabase(); for(let n=0;n<205;n++) await db.put("messages",message(`m${String(n).padStart(4,"0")}`,"resumeKeyword"));
  const engine=new MessageFullTextSearch(); await engine.prepare(); const old=(await engine.status()).active, controller=new AbortController();
  await expect(engine.rebuild({ signal:controller.signal,onProgress:p=>{ if(p.phase==="building") controller.abort(); } })).rejects.toThrow();
  const interrupted=await engine.status(); expect(interrupted.active).toBe(old); expect(interrupted.building?.processed).toBe(100);
  const resumed=new MessageFullTextSearch(); expect((await resumed.search("resumeKeyword",{limit:100})).total).toBe(205); await resumed.settleMaintenance(); expect((await resumed.status()).active).not.toBe(old); expect((await resumed.status()).building).toBeUndefined();
  expect(await db.count("messages")).toBe(205);
});
it("safely upgrades index versions and rebuilds missing or invalid derived data", async () => {
  const db=await getDatabase(); await db.put("messages",message("one","safeRecovery")); const engine=new MessageFullTextSearch(); await engine.prepare(); const old=(await engine.status()).active;
  const upgraded=new MessageFullTextSearch(MESSAGE_SEARCH_VERSION + 1); expect((await upgraded.search("safeRecovery")).hits).toHaveLength(1); expect((await upgraded.status()).active).not.toBe(old);
  const document=(await db.getAll("messageSearchDocuments"))[0]; await db.delete("messageSearchDocuments",document.id);
  expect((await new MessageFullTextSearch(MESSAGE_SEARCH_VERSION + 1).search("safeRecovery")).hits).toHaveLength(1); expect((await db.get("messages","one"))?.content).toBe("safeRecovery");
});
it("never returns deleted or edited source data from a stale cache",async()=>{
  const db=await getDatabase(), engine=new MessageFullTextSearch(); await db.put("messages",message("one","originalAnswer")); await engine.prepare(); await db.put("messages",message("one","changedAnswer"));
  expect((await engine.search("originalAnswer")).hits).toEqual([]); expect((await engine.search("changedAnswer")).hits).toHaveLength(1);
});
it("rebuilds corrupt derived content instead of treating it as original evidence",async()=>{
  const db=await getDatabase(); await db.put("messages",message("one","trustedOriginal")); await new MessageFullTextSearch().prepare();
  const document=(await db.getAll("messageSearchDocuments"))[0]; await db.put("messageSearchDocuments",{...document,body:"corrupt forged text"});
  const result=await new MessageFullTextSearch().search("trustedOriginal"); expect(result.hits).toHaveLength(1); expect(result.hits[0].summary).toContain("trustedOriginal"); expect((await db.get("messages","one"))?.content).toBe("trustedOriginal");
});
it("recovers a corrupt interrupted staging generation before promotion", async () => {
  const db = await getDatabase(); for (let i = 0; i < 105; i++) await db.put("messages", message(`m${String(i).padStart(3,"0")}`, "stagingRecovery"));
  const engine = new MessageFullTextSearch(); await engine.prepare(); const controller = new AbortController();
  await expect(engine.rebuild({ signal: controller.signal, onProgress: p => { if (p.phase === "building") controller.abort(); } })).rejects.toThrow();
  const staging = (await engine.status()).building!.generation, row = (await db.getAllFromIndex("messageSearchDocuments", "generation", staging))[0];
  await db.put("messageSearchDocuments", { ...row, body: "corrupted staging text" });
  const recovered = new MessageFullTextSearch(); expect((await recovered.search("stagingRecovery")).total).toBe(105); await recovered.settleMaintenance(); expect(await db.count("messages")).toBe(105); expect((await engine.status()).building).toBeUndefined();
});
it("keeps the old generation and original messages after an index write failure",async()=>{
  const db=await getDatabase(), engine=new MessageFullTextSearch(); await db.put("messages",message("one","quotaSafe")); await engine.prepare(); const active=(await engine.status()).active;
  const transaction=db.transaction.bind(db), spy=vi.spyOn(db,"transaction");
  spy.mockImplementation(((names: unknown, mode: unknown, options: unknown)=>{ if(Array.isArray(names)&&names.includes("messageSearchDocuments")&&mode==="readwrite") throw new DOMException("synthetic quota failure","QuotaExceededError"); return transaction(names as never,mode as never,options as never); }) as unknown as typeof db.transaction);
  await expect(engine.rebuild()).rejects.toThrow("quota failure"); spy.mockRestore();
  expect((await engine.status()).active).toBe(active); expect((await db.get("messages","one"))?.content).toBe("quotaSafe"); expect((await new MessageFullTextSearch().search("quotaSafe")).hits).toHaveLength(1);
});
it("indexes only committed originals when a synchronization transaction rolls back",async()=>{
  const db=await getDatabase(), engine=new MessageFullTextSearch(); await db.put("messages",message("one","committedAnswer")); await engine.prepare();
  const tx=db.transaction("messages","readwrite"); await tx.store.put(message("one","failedAnswer")); tx.abort(); await tx.done.catch(()=>undefined);
  await engine.updateMessages(["one"]); expect((await engine.search("committedAnswer")).hits).toHaveLength(1); expect((await engine.search("failedAnswer")).hits).toEqual([]);
});
