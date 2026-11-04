import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { prepareMessageVectors } from "./semantic-index";
import { resolveEmbeddingProvider } from "../ai/embedding-provider";
import { hasProviderPermission } from "../ai/provider";
vi.mock("../ai/embedding-provider",()=>({resolveEmbeddingProvider:vi.fn()}));
vi.mock("../ai/provider",()=>({hasProviderPermission:vi.fn(async()=>true)}));
const embedBatch=vi.fn(async(texts:string[])=>texts.map(()=>[1,0]));
beforeEach(async()=>{
 vi.clearAllMocks();vi.mocked(hasProviderPermission).mockResolvedValue(true);
 vi.mocked(resolveEmbeddingProvider).mockResolvedValue({modelKey:"bounded-index",embedBatch,embedText:vi.fn()});
 const db=await getDatabase();for(const name of ["messages","conversations","semanticVectors"] as const)await db.clear(name);
 await db.put("aiSettings",{id:"ai-settings",provider:"openai",baseUrl:"https://embedding.invalid/v1",apiKey:"test",model:"chat",embeddingModel:"vector",updatedAt:1});
 for(const id of ["selected","outside"])await db.put("conversations",{id,title:id,platform:"chatgpt",url:"",messageCount:1,updatedAt:1});
 for(const [id,content] of [["selected","光学检测与信号处理。".repeat(14000)],["outside","EXCLUDED_HISTORY"]])await db.put("messages",{id,conversationId:id,role:"user",messageIndex:0,content,preview:"",contentHash:"",createdAt:10,updatedAt:10});
});
it("builds only an explicitly selected scope with a 32-window budget and resumes without re-embedding",async()=>{
 const first=await prepareMessageVectors(["selected"]);
 expect(first.indexed).toBe(32);expect(first.remaining).toBeGreaterThan(0);
 expect(embedBatch.mock.calls.flatMap(call=>call[0])).toHaveLength(32);
 expect(embedBatch.mock.calls.flatMap(call=>call[0]).some(text=>text.includes("EXCLUDED_HISTORY"))).toBe(false);
 const second=await prepareMessageVectors(["selected"]);expect(second.indexed).toBe(64);
 expect(embedBatch.mock.calls.flatMap(call=>call[0])).toHaveLength(64);
 let last=second;while(last.remaining)last=await prepareMessageVectors(["selected"]);
 const calls=embedBatch.mock.calls.length;
 expect((await prepareMessageVectors(["selected"])).remaining).toBe(0);expect(embedBatch).toHaveBeenCalledTimes(calls);
 const db=await getDatabase(),message=(await db.get("messages","selected"))!;await db.put("messages",{...message,content:"改"+message.content.slice(1)});
 await prepareMessageVectors(["selected"]);expect(embedBatch).toHaveBeenCalledTimes(calls+1);expect(embedBatch.mock.calls.at(-1)![0]).toHaveLength(1);
});
it("does not upload text outside date scope or without permission",async()=>{
 expect((await prepareMessageVectors(["selected"],{from:20})).total).toBe(0);expect(embedBatch).not.toHaveBeenCalled();
 vi.mocked(hasProviderPermission).mockResolvedValue(false);
 await expect(prepareMessageVectors(["selected"])).rejects.toThrow("PERMISSION_REQUIRED");expect(embedBatch).not.toHaveBeenCalled();
});
