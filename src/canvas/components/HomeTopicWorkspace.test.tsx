import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeTopicWorkspace } from "./HomeTopicWorkspace";
import { getDatabase } from "../../storage/db";
import { saveAISettings } from "../../storage/knowledge-graph";
import { sourceMessageSignature } from "../../shared/source-signature";
import * as discovery from "../../ai/history-discovery";
import type { Conversation } from "../../shared/types";
import { PreferencesProvider } from "../preferences";
import { listHomeResults } from "../../storage/home-results";

const sources:Conversation[]=["a","b","c"].map(id=>({id,title:"数据库项目",platform:"chatgpt",url:"",messageCount:2,updatedAt:1,hydrationState:"hydrated",importState:"complete"}));
const props=()=>({goal:"发现可以继续的数据库项目",poolIds:["a","b"],conversations:sources,zh:true,onBack:vi.fn(),onRequest:vi.fn(),onSelectedIds:vi.fn()});
beforeEach(async()=>{localStorage.setItem("atlas-locale","zh-CN");await(await getDatabase()).clear("semanticDecisionCache");await(await getDatabase()).clear("homeResults");await saveAISettings({mode:"byok",provider:"openai",baseUrl:"https://fixture.example/v1",apiKey:"fixture",model:"fixture"});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("opens saved experimental discoveries read-only without analysis, retry controls or data writes",async()=>{
 const recommend=vi.spyOn(discovery,"recommendHistory"),value=props();
 render(<PreferencesProvider><HomeTopicWorkspace {...value} readOnly initialActivity={{id:"archived-topic",kind:"discovery",question:value.goal,topicGoal:value.goal,poolIds:["a","b"],createdAt:1,status:"completed",candidates:[]}}/></PreferencesProvider>);
 await screen.findByText("暂未发现有充分依据的共同主题。");
 expect(screen.getByText(/仅供查看；该功能暂未开放/)).toBeVisible();
 expect(screen.queryByRole("button",{name:"重新发现"})).toBeNull();expect(screen.queryByRole("button",{name:"重试"})).toBeNull();
 expect(recommend).not.toHaveBeenCalled();expect(await listHomeResults()).toEqual([]);
});
it("analyzes the supplied goal and pool in the workspace, cancels stale results and preserves the goal on back",async()=>{
 let notify:Parameters<typeof discovery.recommendHistory>[5],resolve:((rows:Awaited<ReturnType<typeof discovery.recommendHistory>>)=>void)|undefined;
 const recommend=vi.spyOn(discovery,"recommendHistory").mockImplementation(async(_ai,_pool,_profiles,_zh,_signal,onProgress)=>{notify=onProgress;return new Promise(done=>{resolve=done;});});
 const value=props(),{unmount}=render(<PreferencesProvider><HomeTopicWorkspace {...value}/></PreferencesProvider>);
 await waitFor(()=>expect(recommend).toHaveBeenCalledOnce());expect(recommend.mock.calls[0][1].map(row=>row.id)).toEqual(["a","b"]);expect(recommend.mock.calls[0][6]).toBe(value.goal);
 act(()=>notify?.({phase:"checking",done:1,total:2,candidates:[{title:"数据库项目",kind:"project",sourceIds:["a","b"],basis:"recommendation",reason:"共同目标"}],failedGroups:0,pendingSources:0}));expect(screen.getByRole("button",{name:/数据库项目.*整理项目/})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"返回"}));expect(value.onBack).toHaveBeenCalledWith(value.goal);unmount();expect(recommend.mock.calls[0][4]?.aborted).toBe(true);await act(async()=>resolve?.([]));expect(value.onRequest).not.toHaveBeenCalled();
});
it("reports failures only in the workspace and retries without creating a project",async()=>{
 const recommend=vi.spyOn(discovery,"recommendHistory").mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]),value=props();
 render(<PreferencesProvider><HomeTopicWorkspace {...value}/></PreferencesProvider>);await screen.findByRole("alert");expect(screen.getByRole("button",{name:"重试"})).toBeEnabled();fireEvent.click(screen.getByRole("button",{name:"重试"}));await screen.findByText("暂未发现有充分依据的共同主题。");expect(recommend).toHaveBeenCalledTimes(2);expect(value.onRequest).not.toHaveBeenCalled();
});
it("rechecks real evidence before continuing with exactly the candidate's pool",async()=>{
 const db=await getDatabase(),evidence=[];
 for(const source of sources.slice(0,2)){const content="数据库项目采用本地索引";await db.put("conversations",source);await db.put("messages",{id:source.id+":proof",conversationId:source.id,role:"user",messageIndex:0,content,contentHash:"",preview:"",createdAt:1,updatedAt:1});evidence.push({id:source.id+":e",conversationId:source.id,messageId:source.id+":proof",title:source.title,excerpt:content,sourceSignature:sourceMessageSignature(content)});}
 vi.spyOn(discovery,"recommendHistory").mockResolvedValue([{title:"数据库项目",kind:"project",sourceIds:["a","b"],basis:"recommendation",reason:"同一数据库目标",evidence}]);const value={...props(),poolIds:["a","b","c"]};
 render(<PreferencesProvider><HomeTopicWorkspace {...value}/></PreferencesProvider>);fireEvent.click(await screen.findByRole("button",{name:/数据库项目.*整理项目/}));await waitFor(()=>expect(value.onRequest).toHaveBeenCalledWith("帮我整理成一个项目：数据库项目",["a","b"],"project"));expect(value.onSelectedIds).toHaveBeenCalledWith(new Set(["a","b"]));
});
it("records a submitted discovery even before model configuration without making up completed results",async()=>{
 await(await getDatabase()).clear("aiSettings");const recommend=vi.spyOn(discovery,"recommendHistory"),onHistory=vi.fn();render(<HomeTopicWorkspace {...props()} onHistory={onHistory}/>);
 await waitFor(async()=>expect(await listHomeResults()).toEqual([expect.objectContaining({kind:"discovery",question:props().goal,poolIds:["a","b"],status:"started"})]));fireEvent.click(screen.getByRole("button",{name:"历史记录"}));await waitFor(()=>expect(onHistory).toHaveBeenCalledOnce());expect(recommend).not.toHaveBeenCalled();expect(onHistory.mock.calls[0][0].candidates).toBeUndefined();
});
it("reopens a saved topic record without model calls and only reanalyzes after an explicit action",async()=>{
 const recommend=vi.spyOn(discovery,"recommendHistory").mockResolvedValue([]),initialActivity={id:"saved-topic",kind:"discovery" as const,question:props().goal,topicGoal:props().goal,poolIds:["a","b"],createdAt:1,status:"completed" as const,candidates:[]};
 render(<HomeTopicWorkspace {...props()} initialActivity={initialActivity}/>);await screen.findByText("暂未发现有充分依据的共同主题。");await screen.findByRole("combobox",{name:"选择生成 AI"});expect(recommend).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"重新发现"}));await waitFor(()=>expect(recommend).toHaveBeenCalledOnce());await waitFor(async()=>expect(await listHomeResults()).toEqual([expect.objectContaining({id:"saved-topic",status:"completed",candidates:[]})]));
});
