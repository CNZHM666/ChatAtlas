import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { executeSidecarAction } from "./sidecar-actions";
import type { ConversationMessage } from "../shared/types";
vi.mock("../canvas/open-native-discussion",()=>({openNativeDiscussion:vi.fn(async()=>"located")}));
import {openNativeDiscussion} from "../canvas/open-native-discussion";
const getMessages = vi.fn(), sync = vi.fn(), sendMessage = vi.fn(), getTab = vi.fn();
const sender = { tab: { id: 42 }, url: "chrome-extension://atlas/sidecar.html?conversation=current" } as chrome.runtime.MessageSender;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("chrome", { runtime: { getURL: (path: string) => `chrome-extension://atlas/${path}` }, tabs: { get: getTab, sendMessage } });
  getTab.mockResolvedValue({ id: 42, url: "https://chatgpt.com/c/current" }); sendMessage.mockResolvedValue({ ok: true });
  getMessages.mockResolvedValue([{ id: "question", platformMessageId: "native-question", role: "user", messageIndex: 0, contentHash: "hash", preview: "question" }, { id: "answer", role: "assistant", messageIndex: 1 }] as ConversationMessage[]);
});
afterEach(() => vi.unstubAllGlobals());
it.each(["https://claude.ai/chat/abc","https://gemini.google.com/app/abc","https://chat.deepseek.com/a/chat/s/abc","https://www.doubao.com/chat/123","https://kimi.com/chat/abc","https://chat.qwen.ai/c/abc"])("supports sync, source location and insertion on a reviewed native panel: %s",async url=>{
 const {webConversation}=await import("../shared/web-capture"),id=webConversation(url)!.id;
 getTab.mockResolvedValue({id:42,active:true,url});const native={url:"chrome-extension://atlas/sidecar.html?native=1"};
 await executeSidecarAction({type:"ATLAS_SIDECAR_SYNC",conversationId:id,tabId:42},native,{getMessages,sync});expect(sync).toHaveBeenCalledWith(42,id);
 await executeSidecarAction({type:"ATLAS_SIDECAR_LOCATE",conversationId:id,messageId:"question",tabId:42},native,{getMessages,sync});expect(sendMessage).toHaveBeenLastCalledWith(42,expect.objectContaining({type:"ATLAS_LOCATE_MESSAGE",conversationId:id}));
 await executeSidecarAction({type:"ATLAS_SIDECAR_HANDOFF",conversationId:id,text:"Context",tabId:42},native,{getMessages,sync});expect(sendMessage).toHaveBeenLastCalledWith(42,{type:"ATLAS_FILL_COMPOSER",conversationId:id,text:"Context"});
 getTab.mockResolvedValue({id:42,active:true,url:"https://chatgpt.com/c/abc"});await expect(executeSidecarAction({type:"ATLAS_SIDECAR_SYNC",conversationId:id,tabId:42},native,{getMessages,sync})).rejects.toThrow("已切换");
});
it("rejects a native panel target different from the tab encoded in its own instance URL",async()=>{
 const bound={url:"chrome-extension://atlas/sidecar.html?native=1&tabId=42"} as chrome.runtime.MessageSender;
 const action={type:"ATLAS_SIDECAR_HANDOFF" as const,conversationId:"current",text:"reviewed",tabId:43};
 await expect(executeSidecarAction(action,bound,{getMessages,sync})).rejects.toThrow("目标标签页不一致");
 expect(getTab).not.toHaveBeenCalled();expect(sendMessage).not.toHaveBeenCalled();
 getTab.mockResolvedValue({id:42,active:true,url:"https://chatgpt.com/c/current"});
 await executeSidecarAction({...action,tabId:42},bound,{getMessages,sync});
 expect(sendMessage).toHaveBeenCalledWith(42,expect.objectContaining({text:"reviewed"}));
});
it("binds native panel actions to its reviewed active tab and rejects an inactive or navigated target",async()=>{
 const nativeSender={url:"chrome-extension://atlas/sidecar.html?native=1"} as chrome.runtime.MessageSender;
 const action={type:"ATLAS_SIDECAR_HANDOFF" as const,conversationId:"current",text:"reviewed context",tabId:42};
 getTab.mockResolvedValue({id:42,active:true,url:"https://chatgpt.com/c/current"});
 await executeSidecarAction(action,nativeSender,{getMessages,sync});expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42,{type:"ATLAS_FILL_COMPOSER",conversationId:"current",text:"reviewed context"});
 sendMessage.mockClear();getTab.mockResolvedValue({id:42,active:false,url:"https://chatgpt.com/c/current"});await expect(executeSidecarAction(action,nativeSender,{getMessages,sync})).rejects.toThrow("标签页已切换");
 getTab.mockResolvedValue({id:42,active:true,url:"https://claude.ai/new"});await expect(executeSidecarAction(action,nativeSender,{getMessages,sync})).rejects.toThrow("当前对话已切换");expect(sendMessage).not.toHaveBeenCalled();
});
it("locates the actual question in the iframe's host tab, not an arbitrary active tab", async () => {
  await executeSidecarAction({ type: "ATLAS_SIDECAR_LOCATE", conversationId: "current", messageId: "answer" }, sender, { getMessages, sync });
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42, { type: "ATLAS_LOCATE_MESSAGE", conversationId: "current", identity: { messageId: "native-question", contentHash: "hash", preview: "question", messageIndex: 0, role: "user", messageCount: 2 } }); expect(sync).not.toHaveBeenCalled();
});
it("reads committed originals instead of a stale reader cache when locating a directory question",async()=>{
 const current=await getMessages();getMessages.mockImplementation(async(_id,options)=>options?.cache===false?current:[]);
 await executeSidecarAction({type:"ATLAS_SIDECAR_LOCATE",conversationId:"current",messageId:"question"},sender,{getMessages,sync});
 expect(getMessages).toHaveBeenLastCalledWith("current",{cache:false});expect(sendMessage).toHaveBeenCalledWith(42,expect.objectContaining({identity:expect.objectContaining({messageId:"native-question"})}));
});
it("recovers an internal ID change from the exact native question ID and rejects conflicting identities",async()=>{
 await executeSidecarAction({type:"ATLAS_SIDECAR_LOCATE",conversationId:"current",messageId:"old-internal-id",platformMessageId:"native-question"},sender,{getMessages,sync});
 expect(sendMessage).toHaveBeenCalledOnce();sendMessage.mockClear();
 await expect(executeSidecarAction({type:"ATLAS_SIDECAR_LOCATE",conversationId:"current",messageId:"question",platformMessageId:"native-other-branch"},sender,{getMessages,sync})).rejects.toThrow("记录已更新");
 await expect(executeSidecarAction({type:"ATLAS_SIDECAR_LOCATE",conversationId:"current",messageId:"deleted"},sender,{getMessages,sync})).rejects.toThrow("刷新重点");expect(sendMessage).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();
});
it("rejects a page caller or a changed/different source before reading any stored message", async () => {
  await expect(executeSidecarAction({ type: "ATLAS_SIDECAR_LOCATE", conversationId: "current", messageId: "answer" }, { ...sender, url: "https://chatgpt.com/c/current" }, { getMessages, sync })).rejects.toThrow();
  getTab.mockResolvedValue({ url: "https://chatgpt.com/c/other" });
  await expect(executeSidecarAction({ type: "ATLAS_SIDECAR_LOCATE", conversationId: "current", messageId: "answer" }, sender, { getMessages, sync })).rejects.toThrow();
  expect(getMessages).not.toHaveBeenCalled(); expect(sendMessage).not.toHaveBeenCalled();
});
it("syncs only the explicit current conversation in the bound tab", async () => {
  sync.mockResolvedValue({ ok: true });
  expect(await executeSidecarAction({ type: "ATLAS_SIDECAR_SYNC", conversationId: "current" }, sender, { getMessages, sync })).toEqual({ ok: true });
  expect(sync).toHaveBeenCalledExactlyOnceWith(42, "current"); expect(getMessages).not.toHaveBeenCalled();
});
it("captures visible messages only in its own bound frame, without syncing or running analysis", async () => {
  await executeSidecarAction({ type: "ATLAS_SIDECAR_CAPTURE", conversationId: "current" }, sender, { getMessages, sync });
  expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42, { type: "ATLAS_CAPTURE_NOW" });
  expect(sync).not.toHaveBeenCalled(); expect(getMessages).not.toHaveBeenCalled();
  await expect(executeSidecarAction({ type: "ATLAS_SIDECAR_CAPTURE", conversationId: "current" }, { ...sender, url: "chrome-extension://atlas/sidecar.html?conversation=other" }, { getMessages, sync })).rejects.toThrow();
});
it("hands context to its own tab only, including a welcome-page frame", async () => {
  const text="Saved project and my notes";
  await executeSidecarAction({type:"ATLAS_SIDECAR_HANDOFF",conversationId:"current",text},sender,{getMessages,sync});
  expect(sendMessage).toHaveBeenCalledWith(42,{type:"ATLAS_FILL_COMPOSER",conversationId:"current",text});
  getTab.mockResolvedValue({url:"https://chatgpt.com/"});
  await executeSidecarAction({type:"ATLAS_SIDECAR_HANDOFF",conversationId:"",text},{...sender,url:"chrome-extension://atlas/sidecar.html?conversation="},{getMessages,sync});
  expect(sendMessage).toHaveBeenLastCalledWith(42,{type:"ATLAS_FILL_COMPOSER",conversationId:"",text});
  expect(getMessages).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled();
});
it("rejects spoofed frames, navigation races and oversized handoffs without forwarding context", async () => {
  const action={type:"ATLAS_SIDECAR_HANDOFF" as const,conversationId:"current",text:"context"};
  await expect(executeSidecarAction(action,{...sender,url:"https://chatgpt.com/c/current"},{getMessages,sync})).rejects.toThrow();
  await expect(executeSidecarAction(action,{...sender,url:"chrome-extension://atlas/sidecar.html?conversation=other"},{getMessages,sync})).rejects.toThrow();
  getTab.mockResolvedValue({url:"https://chatgpt.com/c/other"});
  await expect(executeSidecarAction(action,sender,{getMessages,sync})).rejects.toThrow();
  getTab.mockResolvedValue({url:"https://chatgpt.com/c/current"});
  await expect(executeSidecarAction({...action,text:"x".repeat(1_000_001)},sender,{getMessages,sync})).rejects.toThrow();
  expect(sendMessage).not.toHaveBeenCalled();
});

it("opens a different stored ChatGPT conversation without relaxing sync or handoff scope",async()=>{
 const source={id:"other",title:"Other",platform:"chatgpt",url:"https://chatgpt.com/c/other",updatedAt:1,messageCount:2},getConversation=vi.fn(async()=>source);
 const result=await executeSidecarAction({type:"ATLAS_SIDECAR_OPEN_ORIGINAL",conversationId:"other",messageId:"answer"},sender,{getMessages,getConversation,sync});expect(result).toEqual({ok:true,located:true});expect(openNativeDiscussion).toHaveBeenCalledWith(source,await getMessages(),"answer");expect(sync).not.toHaveBeenCalled();
 await expect(executeSidecarAction({type:"ATLAS_SIDECAR_SYNC",conversationId:"other"},sender,{getMessages,getConversation,sync})).rejects.toThrow("当前对话已切换");expect(sync).not.toHaveBeenCalled();
});
it("rejects unsafe or mismatched stored original addresses and changed host pages",async()=>{
 const source={id:"other",title:"Other",platform:"chatgpt",url:"https://chatgpt.com/c/other",updatedAt:1,messageCount:1},action={type:"ATLAS_SIDECAR_OPEN_ORIGINAL" as const,conversationId:"other",messageId:"answer"};
 for(const url of ["https://chatgpt.com.evil.test/c/other","javascript:alert(1)","https://chatgpt.com/c/different"]){await expect(executeSidecarAction(action,sender,{getMessages,sync,getConversation:async()=>({...source,url})})).rejects.toThrow("地址不可用");}
 expect(openNativeDiscussion).not.toHaveBeenCalled();getTab.mockResolvedValueOnce({url:"https://chatgpt.com/c/current"}).mockResolvedValueOnce({url:"https://chatgpt.com/c/changed"});await expect(executeSidecarAction(action,sender,{getMessages,sync,getConversation:async()=>source})).rejects.toThrow("当前页面已变化");expect(openNativeDiscussion).not.toHaveBeenCalled();
});
