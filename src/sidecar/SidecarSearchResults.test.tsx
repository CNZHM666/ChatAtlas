import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SidecarSearchResults } from "./SidecarSearchResults";
import { highlightSource, highlightMessages } from "../test/discussion-highlight-fixture";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it.each([false,true])("exposes native source location for supported AI results in compact=%s",async compact=>{
 const send=vi.fn(async()=>({ok:true}));vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const conversation={...highlightSource,id:"claude:thread",platform:"claude",url:"https://claude.ai/chat/thread"},message={...highlightMessages()[0],conversationId:"claude:thread"};
 render(<SidecarSearchResults compact={compact} hits={[{id:"hit",conversation,message,excerpt:"Original"}]} conversationId="claude:thread" zh onOpen={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:compact?/^在原平台定位：/u:"在原生 AI 中定位"}));await screen.findByText("已定位原文");expect(send).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_SIDECAR_LOCATE",conversationId:"claude:thread",messageId:message.id});
});
it("separates native location from Reader and limits initial matches without losing them", async () => {
  const send = vi.fn(async () => ({ ok: true })), open = vi.fn();
  vi.stubGlobal("chrome", { runtime: { sendMessage: send } });
  const hits = highlightMessages().map(message => ({ id: message.id, conversation: highlightSource, message, excerpt: message.content }));
  render(<SidecarSearchResults hits={hits} conversationId={highlightSource.id} zh onOpen={open}/>);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);expect(screen.queryByRole("checkbox")).toBeNull();
  const row = screen.getAllByRole("listitem")[1];
  fireEvent.click(within(row).getByRole("button", { name: "在原生 AI 中定位" }));
  await screen.findByText("已定位原文");
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "ATLAS_SIDECAR_LOCATE", conversationId: highlightSource.id, messageId: hits[1].message.id });expect(open).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "在 Reader 阅读" }));
  expect(open).toHaveBeenCalledWith(highlightSource, hits[1].message, undefined, undefined);
  fireEvent.click(screen.getByRole("button", { name: /更多匹配/ }));expect(screen.getAllByRole("listitem")).toHaveLength(hits.length);
});

it("switches matching conversations without losing results and locates another native conversation",async()=>{
 const send=vi.fn(async()=>({ok:true,located:false}));vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const messages=highlightMessages(),other={...highlightSource,id:"other",title:"其他对话"};
 render(<SidecarSearchResults hits={[{id:"a",conversation:highlightSource,message:messages[0],excerpt:"原对话结果"},{id:"b",conversation:other,message:{...messages[1],conversationId:"other"},excerpt:"其他对话结果"}]} conversationId={highlightSource.id} zh onOpen={vi.fn()}/>);
 fireEvent.change(screen.getByRole("combobox",{name:"切换结果对话"}),{target:{value:"other"}});expect(screen.queryByText("原对话结果")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"在原生 AI 中定位"}));await screen.findByText(/已打开原始对话/);expect(send).toHaveBeenCalledWith({type:"ATLAS_SIDECAR_OPEN_ORIGINAL",conversationId:"other",messageId:messages[1].id});
 fireEvent.change(screen.getByRole("combobox",{name:"切换结果对话"}),{target:{value:""}});expect(screen.getByText("原对话结果")).toBeVisible();
});
it.each(["newest","oldest"] as const)("sorts original message times, leaving undated imports last: %s",order=>{
 const message=highlightMessages()[0];const hits=[undefined,1000,3000,2000].map((sourceCreatedAt,index)=>({id:String(index),conversation:highlightSource,message:{...message,id:String(index),sourceCreatedAt,updatedAt:999999-index},excerpt:`result ${index}`}));
 render(<SidecarSearchResults hits={hits} conversationId="" zh order={order} onOpen={vi.fn()}/>);fireEvent.click(screen.getByRole("button",{name:/更多匹配/}));expect(screen.getAllByRole("listitem").map(row=>row.querySelector("p")?.textContent)).toEqual(order==="newest"?["result 2","result 3","result 1","result 0"]:["result 1","result 3","result 2","result 0"]);
});

it("locates a card's best match on the original platform with one click, reads it in Reader from the icon, and does the same for other matches",async()=>{
 const send=vi.fn(async()=>({ok:true})),open=vi.fn();vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const hits=highlightMessages().map(message=>({id:message.id,conversation:highlightSource,message,excerpt:`关于方案的讨论：${message.content}`}));
 const {container}=render(<SidecarSearchResults compact query="方案" hits={hits} conversationId="other" zh onOpen={open}/>);
 // No expanders, context toggles or separate read buttons.
 expect(screen.queryByText("查看原文")).toBeNull();expect(screen.queryByText("前后问答")).toBeNull();expect(screen.queryByText("连续阅读")).toBeNull();
 expect(container.querySelector(".memory-source-main mark")?.textContent).toBe("方案");
 fireEvent.click(screen.getByRole("button",{name:`在原平台定位：${highlightSource.title}`}));
 await waitFor(()=>expect(send).toHaveBeenCalledWith({type:"ATLAS_SIDECAR_OPEN_ORIGINAL",conversationId:highlightSource.id,messageId:hits[0].message.id}));
 fireEvent.click(screen.getByRole("button",{name:`在 Reader 阅读：${highlightSource.title}`}));
 expect(open).toHaveBeenCalledWith(highlightSource,hits[0].message,undefined,expect.objectContaining({hits:expect.arrayContaining([expect.objectContaining({messageId:hits[0].message.id})])}));
 fireEvent.click(screen.getByRole("button",{name:`另有 ${hits.length-1} 处`}));
 fireEvent.click(within(container.querySelector(".memory-source-matches") as HTMLElement).getAllByRole("button")[0]);
 await waitFor(()=>expect(send).toHaveBeenLastCalledWith({type:"ATLAS_SIDECAR_OPEN_ORIGINAL",conversationId:highlightSource.id,messageId:hits[1].message.id}));
});

it("opens Reader at the match at once when the platform reports the question too far back to load quickly",async()=>{
 const send=vi.fn(async()=>({ok:false,error:"x",reader:"far"})),open=vi.fn();vi.stubGlobal("chrome",{runtime:{sendMessage:send}});
 const hits=highlightMessages().slice(0,1).map(message=>({id:message.id,conversation:highlightSource,message,excerpt:message.content}));
 render(<SidecarSearchResults compact query="方案" hits={hits} conversationId={highlightSource.id} zh onOpen={open}/>);
 fireEvent.click(screen.getByRole("button",{name:`在原平台定位：${highlightSource.title}`}));
 await screen.findByText("这条讨论在对话较早的位置，原平台需要逐段加载，已在 Reader 中直接打开。");
 expect(open).toHaveBeenCalledWith(highlightSource,hits[0].message,undefined,expect.objectContaining({query:"方案"}));
});
