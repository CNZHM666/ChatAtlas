import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { prepareMessageVectors } from "../search/semantic-index";
import { messageFullTextSearch } from "../search/message-fulltext";
import { searchMemory } from "./context-engine";

afterEach(()=>vi.restoreAllMocks());
it("uses the saved embedding connection end-to-end: explicit indexing, paraphrase query, shared cache and exact originals",async()=>{
 const db=await getDatabase();for(const name of ["aiSettings","messages","conversations","semanticVectors","aiUsageEvents"] as const)await db.clear(name);
 await db.put("aiSettings",{id:"ai-settings",provider:"openai",baseUrl:"https://vectors.example/v1",apiKey:"synthetic-key",model:"chat-unused",embeddingModel:"test-vector",updatedAt:1});
 const source={id:"integrated",title:"合成历史",platform:"chatgpt",url:"",messageCount:2,updatedAt:1};await db.put("conversations",source);
 for(const [index,content] of ["AI 生成 Operation Plan，确定性执行器修改并校验。","今天天气适合散步。"].entries())await db.put("messages",{id:`m${index}`,conversationId:source.id,content,role:"user",messageIndex:index,preview:content,contentHash:content,createdAt:1,updatedAt:1});
 messageFullTextSearch.invalidate();
 const requests:Array<{model:string;input:string[]}>=[];
 const network=vi.spyOn(globalThis,"fetch").mockImplementation(async(url,init)=>{
   expect(String(url)).toBe("https://vectors.example/v1/embeddings");
   const body=JSON.parse(String(init?.body));requests.push(body);
   return new Response(JSON.stringify({data:body.input.map((text:string,index:number)=>({index,embedding:text.includes("天气")?[0,1]:[1,0]})),usage:{total_tokens:10}}),{status:200,headers:{"content-type":"application/json"}});
 });
 const query="谁替我们把施工指令稳妥落地";
 expect((await searchMemory(query,[source],undefined,{semantic:true})).semantic?.status).toBe("no-index");expect(network).not.toHaveBeenCalled();
 expect((await prepareMessageVectors([source.id])).remaining).toBe(0);expect(requests).toHaveLength(1);expect(requests[0].input).toHaveLength(2);
 const result=await searchMemory(query,[source],undefined,{semantic:true});
 expect(result.hits.map(hit=>hit.id)).toEqual(["m0"]);expect(result.semantic?.status).toBe("ready");
 expect(result.hits[0].sourceRange?.excerpt).toBe(result.hits[0].message.content);
 expect(requests).toHaveLength(2);expect(requests[1].input).toEqual([query]);
 await searchMemory(`  ${query}  `,[source],undefined,{semantic:true});
 expect(requests).toHaveLength(2);expect((await db.getAll("aiUsageEvents")).every(row=>row.taskType==="embedding")).toBe(true);
});
