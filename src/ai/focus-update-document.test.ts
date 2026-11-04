import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { getDatabase } from "../storage/db";
const calls=vi.hoisted(()=>({generate:vi.fn(),state:vi.fn(),history:vi.fn(),query:vi.fn(),organize:vi.fn()}));
vi.mock("./focus-session",()=>({generateFocusSession:calls.generate}));
vi.mock("./project-state",()=>({enrichProjectState:calls.state}));
vi.mock("./project-history",()=>({generateProjectHistory:calls.history}));
vi.mock("./project-query-agent",()=>({answerProjectQuestion:calls.query}));
vi.mock("./wiki-auto-organize",()=>({autoOrganizeWiki:calls.organize,requireOrganizedWiki:(session:FocusSession)=>session}));
vi.mock("./atlas-ai",()=>({createAtlasAI:()=>({modelId:"fixture"})}));
vi.mock("../storage/knowledge-graph",()=>({getAISettings:async()=>({mode:"byok",provider:"openai",model:"fixture",apiKey:"fixture"})}));
import { generateFocusUpdate } from "./focus-update";

const source={id:"document-source",title:"Source",platform:"chatgpt" as const,url:"",messageCount:1,updatedAt:1};
const original:ConversationMessage={id:"document-message",conversationId:source.id,messageIndex:0,role:"user",content:"Keep the original technical conditions.",contentHash:"",preview:"",createdAt:1,updatedAt:1};
const previous:FocusSession={id:"document-old",mode:"work",goal:"Organize the discussion",title:"My document",scope:{kind:"all"},sourceConversationIds:[source.id],sections:[{id:"personal",title:"Personal chapter",body:"My exact personal text.",kind:"finding",origin:"user",userEdited:true,transition:"",evidenceIds:[]}],evidence:[],notes:"Keep notes",projectMaintenance:{overview:"My description"},activeSectionId:"personal",completedSectionIds:[],createdAt:1,updatedAt:1};
const patch:FocusSession={...previous,id:"document-patch",evidence:[{id:"ref",conversationId:source.id,messageId:original.id,title:source.title,excerpt:original.content}],sections:[{id:"generated",title:"Technical conditions",body:original.content,kind:"finding",transition:"",evidenceIds:["ref"]}]};
beforeEach(async()=>{vi.clearAllMocks();const db=await getDatabase();await db.clear("messages");await db.put("messages",original);calls.generate.mockResolvedValue(patch);calls.organize.mockImplementation(async session=>session);});

it("updates document prose without the retired project-state, evolution or Q&A tail",async()=>{
 const before=structuredClone(previous),result=await generateFocusUpdate(previous,[source],"en",new AbortController().signal);
 expect(calls.generate).toHaveBeenCalledOnce();expect(calls.generate.mock.calls[0][9]).toMatchObject({complete:true,skipProjectState:true});
 expect(calls.organize).toHaveBeenCalledOnce();expect(calls.state).not.toHaveBeenCalled();expect(calls.history).not.toHaveBeenCalled();expect(calls.query).not.toHaveBeenCalled();
 expect(result.sections.find(section=>section.id==="personal")?.body).toBe("My exact personal text.");expect(result.sections.some(section=>section.body===original.content)).toBe(true);
 expect(result.notes).toBe(previous.notes);expect(result.projectMaintenance?.overview).toBe("My description");expect(result.sourceVersionIds?.[source.id]).toBeTruthy();expect(previous).toEqual(before);
});

it("rejects a stale update while retaining the original document instead of publishing it",async()=>{
 calls.generate.mockImplementation(async()=>{await(await getDatabase()).put("messages",{...original,content:"A newer correction."});return patch;});
 await expect(generateFocusUpdate(previous,[source],"en",new AbortController().signal)).rejects.toThrow("Original discussions changed");
 expect(previous.sections[0].body).toBe("My exact personal text.");expect(calls.state).not.toHaveBeenCalled();
});
