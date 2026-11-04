import {afterEach,expect,it,vi} from "vitest";
import {messageFullTextSearch} from "../search/message-fulltext";
import {searchSemanticMemory} from "./semantic-memory";
import {searchMemory} from "./context-engine";
vi.mock("./semantic-memory",()=>({searchSemanticMemory:vi.fn()}));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it("shows local matches before optional vectors and returns them when a provider ignores cancellation",async()=>{
 vi.spyOn(messageFullTextSearch,"search").mockResolvedValue({hits:[],total:0,indexedMessages:0,version:3});
 vi.useFakeTimers();vi.mocked(searchSemanticMemory).mockReturnValue(new Promise(()=>{}));const onLocal=vi.fn();
 const request=searchMemory("technicalToken",[],undefined,{semantic:true,onLocal});
 await vi.waitFor(()=>expect(searchSemanticMemory).toHaveBeenCalled());expect(onLocal).toHaveBeenCalledExactlyOnceWith([]);
 await vi.advanceTimersByTimeAsync(10_000);expect(await request).toEqual({hits:[],ai:false,semantic:{status:"timeout"}});
});
it("keeps a real local match and reports the failed optional vector lookup",async()=>{
 const conversation={id:"c",title:"本地依据",platform:"chatgpt",url:"",messageCount:1,updatedAt:1};
 const message={id:"m",conversationId:"c",role:"user" as const,messageIndex:0,content:"technicalToken 保留本地结果",preview:"",contentHash:"",createdAt:1,updatedAt:1};
 vi.spyOn(messageFullTextSearch,"search").mockResolvedValue({hits:[{conversationId:"c",messageId:"m",message,score:1,platform:"chatgpt",timestamp:1,summary:message.content,sourceRange:{start:0,end:message.content.length,part:"content",excerpt:message.content}}],total:1,indexedMessages:1,version:3});
 vi.mocked(searchSemanticMemory).mockRejectedValueOnce(new Error("connection failed"));
 const result=await searchMemory("technicalToken",[conversation],undefined,{semantic:true});
 expect(result.semantic?.status).toBe("error");expect(result.hits.map(hit=>hit.id)).toEqual(["m"]);
});
