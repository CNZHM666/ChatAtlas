import "fake-indexeddb/auto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidecarProject } from "./SidecarProject";
import { projectSession } from "../test/project-fixture";
import { getDatabase } from "../storage/db";
import { savedSidecarProjects } from "./project-model";
import { currentSourceChange, type SourceChange } from "../canvas/source-freshness";
import { invalidateStoredMessageSearchIndex } from "../storage/messages";
vi.mock("../canvas/source-freshness",async original=>({...await original<typeof import("../canvas/source-freshness")>(),currentSourceChange:vi.fn()}));
const unchanged:SourceChange={conversationId:"source",added:0,changed:0,removed:0,unknown:false};
const send=vi.fn(), copy=vi.fn();
beforeEach(async()=>{
  vi.clearAllMocks(); vi.mocked(currentSourceChange).mockResolvedValue(unchanged);
  localStorage.removeItem(`atlas-sidecar-update:${JSON.stringify([projectSession().id,"source"])}`);
  vi.stubGlobal("chrome",{runtime:{sendMessage:send,onMessage:{addListener:vi.fn(),removeListener:vi.fn()}}});
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:copy}}); copy.mockResolvedValue(undefined); send.mockResolvedValue({ok:true});
  const db=await getDatabase(); await db.clear("contextFavorites"); await db.clear("sidecarSearches"); await db.clear("aiSettings"); await db.clear("focusSessions"); await db.clear("conversations"); await db.clear("messages"); await db.clear("canvases"); invalidateStoredMessageSearchIndex();
  const project=projectSession(); project.projectMaintenance={modules:{"module:input":{...project.projectState!.modules[0],purpose:"我的职责修改"}},decisions:{"decision:scope":{text:"先验证核心流程",confirmed:true}},actions:{"action:test":{text:"完成规则校验测试",done:true},"user:next":{text:"补齐边界验证",done:false}}};
  await db.put("focusSessions",project);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const renderProject=(node:React.ReactNode)=>render(node);
it("keeps project linking and local search without context-generation entry points",async()=>{
 renderProject(<SidecarProject conversationId="source" zh/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"关联项目"})).toBeEnabled());
 expect(screen.getByRole("searchbox",{name:"搜索历史对话"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"项目上下文"})).toBeNull();
 expect(screen.queryByRole("button",{name:"复制上下文"})).toBeNull();
 expect(screen.queryByRole("textbox",{name:"当前任务"})).toBeNull();
 expect(copy).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
it("does not select an unrelated project automatically and keeps saved candidates out of the picker",async()=>{
 const saved=projectSession(),candidate={...saved,id:"preview",rootSessionId:saved.id,status:"preview" as const,createdAt:5,updatedAt:5};expect(savedSidecarProjects([saved,candidate]).map(item=>item.id)).toEqual([saved.id]);expect(savedSidecarProjects([candidate])).toEqual([]);
 renderProject(<SidecarProject conversationId="unlinked" zh/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"关联项目"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button",{name:"关联项目"}));
 expect(screen.getByRole("button",{name:`关联到：${saved.title}`})).toBeVisible();
 expect(screen.queryByText(/使用已关联项目/)).toBeNull();expect(screen.queryByRole("button",{name:"复制上下文"})).toBeNull();
});
it("imports the current conversation and labels a repeated sync without calling it an update",async()=>{
  const db=await getDatabase();
  send.mockImplementation(async message=>{
    if(message.type==="ATLAS_SIDECAR_SYNC"){
      const existing=await db.get("conversations",message.conversationId);
      await db.put("conversations",{id:message.conversationId,title:"当前对话",platform:"chatgpt",url:`https://chatgpt.com/c/${message.conversationId}`,updatedAt:Date.now(),messageCount:2,hydrationState:"hydrated",importState:"complete"});
      return {ok:true,summary:{change:existing?"unchanged":"imported"}};
    }
    return {ok:true};
  });
  const {container}=render(<SidecarProject conversationId="source" zh/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"导入当前对话"})).toBeEnabled());
  expect(screen.queryByRole("button",{name:"保存消息"})).not.toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"同步对话"})).not.toBeInTheDocument();
  expect(container.querySelector('input[type="file"]')).toBeNull();
  expect(within(container.querySelector("footer")!).queryByRole("button",{name:/导入/})).not.toBeInTheDocument();
  const button=screen.getByRole("button",{name:"导入当前对话"});fireEvent.click(button);fireEvent.click(button);
  await screen.findByText("当前对话已导入，可在工作台和对话库中查看。");
  expect(send).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_SIDECAR_SYNC",conversationId:"source"});
  await waitFor(()=>expect(screen.getByRole("button",{name:"更新对话"})).toBeEnabled());
  expect(screen.queryByRole("button",{name:"导入当前对话"})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"更新对话"}));
  await screen.findByText("已检查，没有发现新内容。");
  expect(await db.count("conversations")).toBe(1);
  expect(send.mock.calls.map(call=>call[0])).toEqual([{type:"ATLAS_SIDECAR_SYNC",conversationId:"source"},{type:"ATLAS_SIDECAR_SYNC",conversationId:"source"}]);
});

it("reads the linked Wiki in the empty side panel and opens the selected chapter in the workspace",async()=>{
 const db=await getDatabase(),project=projectSession();
 project.sections.push({...project.sections[0],id:"next",title:"后续计划",body:"下一章保留已确认的实施步骤。"});
 await db.put("focusSessions",project);
 renderProject(<SidecarProject conversationId="source" zh/>);
 const wiki=await screen.findByRole("region",{name:"项目 Wiki"});
 expect(within(wiki).getByText(project.title)).toBeVisible();
 expect(screen.getByRole("searchbox",{name:"搜索历史对话"})).toBeVisible();
 fireEvent.click(within(wiki).getByRole("button",{name:"核心流程"}));
 expect(await within(wiki).findByText(/需求采集提取目标与约束/)).toBeVisible();
 expect(screen.queryByRole("searchbox",{name:"搜索历史对话"})).toBeNull();
 const reading=within(wiki).getByRole("article",{name:"核心流程"});
 const pager=within(wiki).getByRole("navigation",{name:"相邻章节"});
 expect(reading).not.toContainElement(pager);
 reading.scrollTop=900;
 expect(within(wiki).getByRole("button",{name:"上一章"})).toBeDisabled();
 fireEvent.click(within(wiki).getByRole("button",{name:"下一章"}));
 expect(await within(wiki).findByText("下一章保留已确认的实施步骤。")).toBeVisible();
 expect(within(wiki).getByRole("article",{name:"后续计划"}).scrollTop).toBe(0);
 fireEvent.click(within(wiki).getByRole("button",{name:"打开工作区"}));
 expect(send).toHaveBeenLastCalledWith({type:"ATLAS_OPEN_REVIEW",sessionId:project.id,sectionId:"next"});
 fireEvent.click(within(wiki).getByRole("button",{name:"章节目录"}));
 expect(screen.getByRole("searchbox",{name:"搜索历史对话"})).toBeVisible();
 fireEvent.change(screen.getByRole("searchbox",{name:"搜索历史对话"}),{target:{value:"计划"}});
 expect(screen.queryByRole("region",{name:"项目 Wiki"})).toBeNull();
});

it("keeps the verified update notice during a fresh check and clears it when the source is current",async()=>{
 const db=await getDatabase();
 const conversation={id:"source",title:"当前对话",platform:"chatgpt" as const,url:"",updatedAt:1,messageCount:2,hydrationState:"hydrated" as const,importState:"complete" as const};
 await db.put("conversations",conversation);
 vi.mocked(currentSourceChange).mockResolvedValueOnce({...unchanged,changed:1});
 renderProject(<SidecarProject conversationId="source" zh/>);
 await screen.findByText("修改 1 条");
 let finish!:(change:SourceChange)=>void;
 vi.mocked(currentSourceChange).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 await db.put("conversations",{...conversation,rawRevision:"new-revision",updatedAt:2});
 fireEvent.focus(window);
 await waitFor(()=>expect(currentSourceChange).toHaveBeenCalledTimes(2));
 expect(screen.getByText("修改 1 条")).toBeVisible();
 await act(async()=>finish(unchanged));
 await waitFor(()=>expect(screen.queryByText("修改 1 条")).toBeNull());
});

it("dismisses the current update across recapture and reopening, then shows a different update with the same count",async()=>{
 const db=await getDatabase();
 const conversation={id:"source",title:"当前对话",platform:"chatgpt" as const,url:"",updatedAt:1,messageCount:2,hydrationState:"hydrated" as const,importState:"complete" as const};
 await db.put("conversations",conversation);
 const first={...unchanged,changed:10,fingerprint:"first-changed-source"};
 vi.mocked(currentSourceChange).mockResolvedValue(first);
 const view=renderProject(<SidecarProject conversationId="source" zh/>);
 fireEvent.click(await screen.findByRole("button",{name:"关闭更新提醒"}));
 expect(screen.queryByText("修改 10 条")).toBeNull();
 expect(send).not.toHaveBeenCalled();
 expect((await db.get("focusSessions",projectSession().id))?.sourceConversationIds).toEqual(["source"]);
 view.unmount();
 renderProject(<SidecarProject conversationId="source" zh/>);
 await waitFor(()=>expect(currentSourceChange).toHaveBeenCalledTimes(2));
 expect(screen.queryByText("修改 10 条")).toBeNull();
 await db.put("conversations",{...conversation,rawRevision:"current-capture",updatedAt:2});
 fireEvent.focus(window);
 await waitFor(()=>expect(currentSourceChange).toHaveBeenCalledTimes(3));
 expect(screen.queryByText("修改 10 条")).toBeNull();
 vi.mocked(currentSourceChange).mockResolvedValue({...first,fingerprint:"different-changed-source"});
 await db.put("conversations",{...conversation,rawRevision:"different-capture",updatedAt:3});
 fireEvent.focus(window);
 expect(await screen.findByText("修改 10 条")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"查看更新"}));
 expect(send).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_OPEN_REVIEW",sessionId:projectSession().id});
});
it("links an unsaved current conversation directly from the searchable picker and keeps manual knowledge",async()=>{
  const db=await getDatabase(), target={...projectSession(),id:"target",canvasId:"target-canvas",title:"ChatAtlas 目标项目"};
  await db.put("focusSessions",target);await db.put("canvases",{id:target.canvasId,name:target.title,createdAt:1,updatedAt:1});
  send.mockImplementation(async message=>{
    if(message.type==="ATLAS_SIDECAR_SYNC")await db.put("conversations",{id:"unsaved",title:"尚未导入的当前讨论",platform:"chatgpt",url:"https://chatgpt.com/c/unsaved",updatedAt:1,messageCount:1,importState:"complete",hydrationState:"hydrated"});
    return {ok:true};
  });
  renderProject(<SidecarProject conversationId="unsaved" zh/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"关联项目"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"关联项目"}));
  const search=screen.getByRole("searchbox",{name:"搜索项目"});expect(search).toHaveFocus();
  fireEvent.change(search,{target:{value:"目标项目"}});
  expect(screen.queryByRole("button",{name:`关联到：${projectSession().title}`})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"关联到：ChatAtlas 目标项目"}));
  await screen.findByText("已关联，整理时再确认项目更新");
  await waitFor(()=>expect(screen.queryByRole("region",{name:"选择关联项目"})).not.toBeInTheDocument());
  expect(send).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_SIDECAR_SYNC",conversationId:"unsaved"});
  const saved=await db.get("focusSessions",target.id);
  expect(saved?.sidecarConversationIds).toContain("unsaved");expect(saved?.sections).toEqual(target.sections);expect(saved?.projectMaintenance).toEqual(target.projectMaintenance);
  fireEvent.click(screen.getByRole("button",{name:"关联项目"}));
  expect(screen.getByRole("button",{name:"使用已关联项目：ChatAtlas 目标项目"})).toBeVisible();
  fireEvent.keyDown(screen.getByRole("searchbox",{name:"搜索项目"}),{key:"Escape"});
  await waitFor(()=>expect(screen.queryByRole("region",{name:"选择关联项目"})).not.toBeInTheDocument());
  // A link made by mistake is undone before the project organizes it.
  fireEvent.click(screen.getByRole("button",{name:"关联项目"}));
  fireEvent.click(screen.getByRole("button",{name:"取消关联：ChatAtlas 目标项目"}));
  await screen.findByText("已取消与「ChatAtlas 目标项目」的关联");
  expect((await db.get("focusSessions",target.id))?.sidecarConversationIds).not.toContain("unsaved");
  expect(screen.getByRole("button",{name:"关联到：ChatAtlas 目标项目"})).toBeVisible();
});
it("does not show the previous conversation's import receipt after switching conversations",async()=>{
  let complete!:(value:unknown)=>void;send.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const view=render(<SidecarProject conversationId="first" conversationTitle="第一个对话" zh/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"导入当前对话"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"导入当前对话"}));
  view.rerender(<SidecarProject conversationId="second" conversationTitle="第二个对话" zh/>);
  await screen.findByText("第二个对话");
  complete({ok:true});
  await waitFor(()=>expect(screen.getByRole("button",{name:"导入当前对话"})).toBeEnabled());
  expect(screen.queryByText("当前对话已导入，可在工作台和对话库中查看。")).not.toBeInTheDocument();
  expect(send).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_SIDECAR_SYNC",conversationId:"first"});
});
