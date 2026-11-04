import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { StructuredAIRequest } from "./provider";
const {synthesize,verifyDraft,enrich,directory}=vi.hoisted(()=>({synthesize:vi.fn(),verifyDraft:vi.fn(),enrich:vi.fn(),directory:vi.fn()}));
vi.mock("./atlas-ai",()=>({createAtlasAI:()=>({modelId:"fixture",canReuseProjectKnowledge:true,synthesize})}));
vi.mock("./project-state",()=>({enrichProjectState:enrich}));
vi.mock("./wiki-directory",async original=>({...await original<typeof import("./wiki-directory")>(),organizeWikiDirectory:directory}));

vi.mock("./wiki-verification",()=>({verifyWikiDraft:verifyDraft,verifyWikiClaims:vi.fn()}));
vi.mock("../storage/knowledge-graph",()=>({getAISettings:async()=>({mode:"byok",provider:"qwen",apiKey:"fixture",baseUrl:"https://fixture.invalid/v1",model:"fixture"})}));
vi.mock("./provider",async original=>({...await original<typeof import("./provider")>(),hasProviderPermission:async()=>true}));
import { generateFocusSession } from "./focus-session";

it("finishes the first project with an overview and locally checked Wiki, without automatic structure or history calls",async()=>{
 // The earlier pipeline, kept as a fallback, is what this test reads.
 vi.stubGlobal("localStorage",{getItem:(key:string)=>key==="atlas-dev-wiki-legacy-pipeline"?"1":null,setItem:()=>undefined,removeItem:()=>undefined});
  const db=await getDatabase(),conversation:Conversation={id:"on-demand-source",title:"硬件项目",platform:"chatgpt",url:"",messageCount:2,updatedAt:1};
  const originals:ConversationMessage[]=["先做浏览器产品。","先验证核心流程，后续再接入库存识别。"].map((content,i)=>({id:`on-demand-${i}`,conversationId:conversation.id,messageIndex:i,role:i?"assistant":"user",content,preview:content,contentHash:String(i),createdAt:1,updatedAt:1}));
  await db.put("conversations",conversation);for(const message of originals)await db.put("messages",message);
  synthesize.mockImplementation(async(request:StructuredAIRequest<unknown>)=>{
    const data=JSON.parse(request.prompt);expect(data.semanticStructure).toBe(false);expect(data.projectKnowledge).toBeUndefined();
    return request.validate({title:"硬件平台",brief:{summary:"先验证浏览器端硬件设计流程。",turningPoints:[],confirmed:[],openQuestions:[]},sections:[{title:"核心流程",body:"先验证核心流程，后续再接入库存识别。",kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id),claims:[{text:"先做浏览器产品。",quote:"先做浏览器产品。",evidenceIds:[data.passages[0].id],overviewRole:"scope"}]}]});
  });
  verifyDraft.mockImplementation(async(session:FocusSession,messages:ConversationMessage[])=>{expect(messages).toEqual(originals);return session;});
  const result=await generateFocusSession("把全部已选对话整理成一个项目","work",[conversation],"zh-CN",new AbortController().signal,undefined,undefined,undefined,undefined,{complete:true});
  expect(result.projectState).toBeUndefined();expect(result.projectHistoryAnalysis).toBeUndefined();expect(result.projectKnowledge).toBeUndefined();
  expect(result.brief?.summary).toBe("先做浏览器产品。");expect(result.knowledgeViewVersion).toBe(1);expect(result.coverage?.sourceCount).toBe(1);
  expect(verifyDraft).not.toHaveBeenCalled();expect(directory).not.toHaveBeenCalled();expect(result.sections[0].evidenceReview?.mode).toBe("manual");expect(enrich).not.toHaveBeenCalled();expect(synthesize).toHaveBeenCalledOnce();
  expect(await db.getAllFromIndex("messages","by-conversation",conversation.id)).toEqual(originals);
});
