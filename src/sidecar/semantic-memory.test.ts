import "fake-indexeddb/auto";
import {beforeEach,expect,it,vi} from "vitest";
import {getDatabase} from "../storage/db";
import {semanticDocumentFingerprint} from "../search/semantic-index";
import {resolveEmbeddingProvider} from "../ai/embedding-provider";
import {hasProviderPermission} from "../ai/provider";
import {semanticMemory,searchSemanticMemory} from "./semantic-memory";
import {searchMemory} from "./context-engine";
import {messageFullTextSearch} from "../search/message-fulltext";
vi.mock("../storage/knowledge-graph",()=>({getAISettings:vi.fn(async()=>({embeddingModel:"test",baseUrl:"https://vectors.invalid"}))}));
vi.mock("../ai/embedding-provider",()=>({resolveEmbeddingProvider:vi.fn()}));
vi.mock("../ai/provider",()=>({hasProviderPermission:vi.fn(async()=>true)}));
const embedText=vi.fn<(text:string,signal?:AbortSignal)=>Promise<number[]>>().mockResolvedValue([1,0]),embedBatch=vi.fn();
const conversation={id:"c:long",title:"历史",platform:"claude",url:"",updatedAt:1,messageCount:1};
const message={id:"m:1",conversationId:conversation.id,role:"user" as const,messageIndex:0,content:"改用执行器。只是方案，尚未执行。",preview:"",contentHash:"",createdAt:10,updatedAt:10};
beforeEach(async()=>{
 vi.clearAllMocks();vi.mocked(hasProviderPermission).mockResolvedValue(true);vi.mocked(resolveEmbeddingProvider).mockResolvedValue({modelKey:"test-model",embedText,embedBatch});
 const db=await getDatabase();await db.clear("semanticVectors");await db.clear("messages");await db.clear("conversations");await db.put("conversations",conversation);await db.put("messages",message);messageFullTextSearch.invalidate();
});
it("uses configured vectors for an unlisted paraphrase, tolerates a response slower than the old 1.8s deadline, and shows local results first",async()=>{
 await seed();embedText.mockImplementationOnce(async()=>{await new Promise(resolve=>setTimeout(resolve,2100));return [1,0];});
 const local=vi.fn();
 const result=await searchMemory("以前由谁安全落实施工命令",[conversation],undefined,{semantic:true,onLocal:local});
 expect(local).toHaveBeenCalledWith([]);expect(result.hits.map(item=>item.id)).toEqual([message.id]);
 expect(result.semantic?.status).toBe("ready");expect(embedText).toHaveBeenCalledOnce();expect(embedBatch).not.toHaveBeenCalled();
},10000);
it("makes skipped retrieval visible and never expands exact quoted search into semantic guesses",async()=>{
 expect((await searchSemanticMemory("改过的问法",[conversation])).report.status).toBe("no-index");
 await seed();expect((await searchSemanticMemory('"已经正式完成执行器"',[conversation])).report.status).toBe("exact");
 expect(embedText).not.toHaveBeenCalled();
 vi.mocked(hasProviderPermission).mockResolvedValue(false);
 expect((await searchSemanticMemory("改过的问法",[conversation])).report.status).toBe("permission");
 expect(embedText).not.toHaveBeenCalled();
});
async function seed(){const id=`passage:${conversation.id}:${message.id}:0`;await(await getDatabase()).put("semanticVectors",{id:`test-model:${id}`,modelKey:"test-model",values:[1,0],updatedAt:1,textHash:semanticDocumentFingerprint({id,conversationId:conversation.id,episodeId:"",title:"",body:message.content,terms:""})});}
it("embeds the query only, reuses its cached vector and checks the exact original message",async()=>{
 await seed();const conversations=[{...conversation,id:"c"},conversation];
 const hits=await semanticMemory("以前为什么换执行器",conversations);expect(hits).toHaveLength(1);expect(hits[0].messageId).toBe(message.id);expect(hits[0].sourceRange.excerpt).toBe(message.content);
 await semanticMemory("以前为什么换执行器",conversations);expect(embedText).toHaveBeenCalledOnce();expect(embedText.mock.calls[0][0]).toBe("以前为什么换执行器");expect(embedBatch).not.toHaveBeenCalled();
 await(await getDatabase()).put("messages",{...message,content:"后来改变的正文"});expect(await semanticMemory("以前为什么换执行器",conversations)).toEqual([]);expect(embedText).toHaveBeenCalledOnce();
});
it("does not build missing vectors, escape scope, ignore permission or mix dates",async()=>{
 expect(await semanticMemory("查找",[conversation])).toEqual([]);expect(embedText).not.toHaveBeenCalled();await seed();
 expect(await semanticMemory("查找",[conversation],{conversationIds:["other"]})).toEqual([]);expect(embedText).not.toHaveBeenCalled();
 expect(await semanticMemory("查找",[conversation],{from:20})).toEqual([]);
 vi.mocked(hasProviderPermission).mockResolvedValue(false);expect(await semanticMemory("new query",[conversation])).toEqual([]);expect(embedBatch).not.toHaveBeenCalled();
});
