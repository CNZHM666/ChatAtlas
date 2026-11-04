import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createWebCaptureManager } from "./web-capture";
import { WEB_CAPTURE_KEY, WEB_CAPTURE_PAUSED_KEY, webCapturePatterns } from "../shared/web-capture";
import type { ConversationCapture } from "../shared/types";
let values:Record<string,unknown>,registered:chrome.scripting.RegisteredContentScript[],grants:Set<string>;
const execute=vi.fn(),register=vi.fn(),unregister=vi.fn(),update=vi.fn();
beforeEach(()=>{
 values={};registered=[];grants=new Set();vi.clearAllMocks();
 register.mockImplementation(async(rows:chrome.scripting.RegisteredContentScript[])=>{registered.push(...rows);});update.mockImplementation(async(rows:chrome.scripting.RegisteredContentScript[])=>{registered=registered.map(row=>rows.find(item=>item.id===row.id)??row);});unregister.mockImplementation(async({ids}:{ids:string[]})=>{registered=registered.filter(row=>!ids.includes(row.id));});
 vi.stubGlobal("chrome",{storage:{local:{get:async()=>({...values}),set:async(next:Record<string,unknown>)=>{Object.assign(values,next);}}},permissions:{contains:async({origins}:{origins:string[]})=>origins.every(origin=>grants.has(origin))},scripting:{getRegisteredContentScripts:async({ids}:{ids:string[]})=>registered.filter(row=>ids.includes(row.id)),registerContentScripts:register,updateContentScripts:update,unregisterContentScripts:unregister,executeScript:execute},tabs:{query:async()=>[{id:42}]}});
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("automatically enables supported websites after browser permission without opt-in",async()=>{
 grants.add("https://claude.ai/*");const manager=createWebCaptureManager("capture.js");await manager.restore();expect(register).toHaveBeenCalledOnce();expect((await manager.status())[0]).toMatchObject({enabled:true,permitted:true});expect(values[WEB_CAPTURE_KEY]).toEqual(["claude"]);
});
it("requires browser permission, injects into existing tabs, and persists explicit pauses",async()=>{
 const manager=createWebCaptureManager("capture.js");await expect(manager.set("claude",true)).rejects.toThrow("not granted");expect(values[WEB_CAPTURE_KEY]).toBeUndefined();
 grants.add("https://claude.ai/*");await manager.set("claude",true);expect(values[WEB_CAPTURE_KEY]).toEqual(["claude"]);expect(register).toHaveBeenCalledWith([expect.objectContaining({matches:["https://claude.ai/*"],js:["capture.js"],persistAcrossSessions:true})]);expect(execute).toHaveBeenCalledWith({target:{tabId:42},files:["capture.js"]});
 await manager.set("claude",false);expect(values[WEB_CAPTURE_KEY]).toEqual([]);expect(unregister).toHaveBeenCalledWith({ids:["atlas-web-capture-claude"]});
 expect(values[WEB_CAPTURE_PAUSED_KEY]).toEqual(["claude"]);await createWebCaptureManager("capture.js").restore();expect(values[WEB_CAPTURE_KEY]).toEqual([]);
});
it("restores opted-in platforms after restart and disables revoked permissions without affecting others",async()=>{
 values[WEB_CAPTURE_KEY]=["claude","gemini"];grants.add("https://claude.ai/*");registered=[{id:"atlas-web-capture-claude",js:["old.js"]},{id:"atlas-web-capture-gemini",js:["old.js"]}];
 await createWebCaptureManager("new.js").restore();expect(values[WEB_CAPTURE_KEY]).toEqual(["claude"]);expect(registered).toEqual([expect.objectContaining({id:"atlas-web-capture-claude",js:["new.js"]})]);
});
it("serializes changes so enabling two platforms does not lose either selection",async()=>{
 grants=new Set(["https://claude.ai/*","https://chat.deepseek.com/*"]);const manager=createWebCaptureManager("reader.js");await Promise.all([manager.set("claude",true),manager.set("deepseek",true)]);expect(values[WEB_CAPTURE_KEY]).toEqual(["claude","deepseek"]);
});
it("accepts only enabled captures matching the sender platform and conversation",async()=>{
 values[WEB_CAPTURE_KEY]=["claude"];grants.add("https://claude.ai/*");const manager=createWebCaptureManager("reader.js"),capture={conversation:{platform:"claude",id:"claude:thread",source:"claude_dom",url:"https://claude.ai/chat/thread"}} as ConversationCapture;
 expect(await manager.accepts(capture,"https://claude.ai/chat/thread")).toBe(true);expect(await manager.accepts(capture,"https://claude.ai/chat/other")).toBe(false);expect(await manager.accepts(capture,"https://claude.ai.example/chat/thread")).toBe(false);
 expect(await manager.accepts({...capture,conversation:{...capture.conversation,url:"https://claude.ai/chat/other"}},"https://claude.ai/chat/thread")).toBe(false);
 expect(await manager.accepts({...capture,conversation:{...capture.conversation,url:"invalid"}},"https://claude.ai/chat/thread")).toBe(false);
 await manager.set("claude",false);expect(await manager.accepts(capture,"https://claude.ai/chat/thread")).toBe(false);
});
it("registers all Kimi aliases under one opt-in and rejects mismatched origins",async()=>{
 grants=new Set(webCapturePatterns("kimi"));const manager=createWebCaptureManager("reader.js");await manager.set("kimi",true);
 expect(register).toHaveBeenCalledWith([expect.objectContaining({matches:webCapturePatterns("kimi")})]);
 const capture={conversation:{platform:"kimi",id:"kimi:abc",source:"kimi_dom",url:"https://kimi.com/chat/abc?chat_enter_method=history"}} as ConversationCapture;
 expect(await manager.accepts(capture,"https://kimi.com/chat/abc")).toBe(true);
 expect(await manager.accepts(capture,"https://www.kimi.com/chat/abc")).toBe(false);
 grants.delete("https://kimi.com/*");await manager.restore();expect(values[WEB_CAPTURE_KEY]).toEqual([]);
});
it("inspects open tabs, bounds capture to the selected identity, and rejects navigation races",async()=>{
 values[WEB_CAPTURE_KEY]=["doubao"];grants=new Set(webCapturePatterns("doubao"));
 const query=vi.fn().mockResolvedValue([{id:7,url:"https://www.doubao.com/chat/123",title:"Saved title"}]);
 const get=vi.fn().mockResolvedValue({id:7,url:"https://www.doubao.com/chat/123"});
 const sendMessage=vi.fn().mockImplementation(async(_id,message)=>message.type==="ATLAS_WEB_PAGE_INSPECT"?{state:"ready",conversationId:"doubao:123",messageCount:2}:{ok:true,summary:{conversationId:"doubao:123",messageCount:2}});
 Object.assign(chrome.tabs,{query,get,sendMessage});
 const manager=createWebCaptureManager("reader.js");expect(await manager.tabs("doubao")).toEqual([{tabId:7,title:"Saved title",url:"https://www.doubao.com/chat/123",state:"ready",conversationId:"doubao:123",messageCount:2}]);
 expect(await manager.captureTab("doubao",7,"doubao:123")).toMatchObject({ok:true});
 expect(sendMessage).toHaveBeenLastCalledWith(7,{type:"ATLAS_CAPTURE_NOW",conversationId:"doubao:123"});
 get.mockResolvedValue({url:"https://www.doubao.com/chat/456"});
 await expect(manager.captureTab("doubao",7,"doubao:123")).rejects.toThrow("Conversation changed");
 get.mockResolvedValue({url:"https://www.doubao.com/chat/123"});
 sendMessage.mockResolvedValue({state:"streaming",conversationId:"doubao:123",messageCount:2});
 await expect(manager.captureTab("doubao",7,"doubao:123")).rejects.toThrow("not ready");
});
it("reports disconnected layouts and refuses inspection/capture after permission revocation",async()=>{
 values[WEB_CAPTURE_KEY]=["claude"];grants.add("https://claude.ai/*");
 Object.assign(chrome.tabs,{query:async()=>[{id:7,url:"https://claude.ai/chat/id",title:"Title"}],sendMessage:async()=>{throw Error("No listener");}});
 const manager=createWebCaptureManager("reader.js");expect((await manager.tabs("claude"))[0].state).toBe("disconnected");
 grants.clear();await expect(manager.tabs("claude")).rejects.toThrow("revoked");await expect(manager.captureTab("claude",7,"claude:id")).rejects.toThrow("revoked");
});
it("resumes after renewed website permission but retains an explicit pause",async()=>{
 const manager=createWebCaptureManager("reader.js");await manager.restore();expect(values[WEB_CAPTURE_KEY]).toEqual([]);
 grants.add("https://claude.ai/*");await manager.restore();expect(values[WEB_CAPTURE_KEY]).toEqual(["claude"]);
 await manager.set("claude",false);grants.clear();await manager.restore();grants.add("https://claude.ai/*");await manager.restore();expect(values[WEB_CAPTURE_KEY]).toEqual([]);
 await manager.set("claude",true);expect(values[WEB_CAPTURE_KEY]).toEqual(["claude"]);
});
it("does not reinject an already connected reader when its worker restarts",async()=>{
 grants.add("https://claude.ai/*");Object.assign(chrome.tabs,{sendMessage:async()=>({state:"ready",messageCount:2})});
 await createWebCaptureManager("reader.js").restore();expect(execute).not.toHaveBeenCalled();
});
it("reads only validated same-origin history entries and rejects source tab navigation",async()=>{
 grants.add("https://claude.ai/*");const get=vi.fn().mockResolvedValue({url:"https://claude.ai/new"});
 Object.assign(chrome.tabs,{get,sendMessage:async()=>({entries:[{conversationId:"claude:a",url:"https://claude.ai/chat/a",title:"A"},{conversationId:"claude:a",url:"https://claude.ai/chat/a",title:"A duplicate"},{conversationId:"gemini:b",url:"https://gemini.google.com/app/b",title:"B"}],scope:"loaded"})});
 const manager=createWebCaptureManager("reader.js");expect(await manager.history("claude",42)).toEqual({scope:"loaded",entries:[{conversationId:"claude:a",url:"https://claude.ai/chat/a",title:"A duplicate"}]});
 get.mockResolvedValueOnce({url:"https://claude.ai/new"}).mockResolvedValueOnce({url:"https://claude.ai/chat/changed"});await expect(manager.history("claude",42)).rejects.toThrow("changed");
});
function importTab(){
 vi.useFakeTimers();grants.add("https://claude.ai/*");
 const tab={id:88,active:false,status:"complete",url:"https://claude.ai/chat/a"};
 const get=vi.fn().mockImplementation(async()=>({...tab})),remove=vi.fn().mockResolvedValue(undefined),create=vi.fn().mockResolvedValue(tab);
 const sendMessage=vi.fn().mockImplementation(async(_id,message)=>message.type==="ATLAS_WEB_PAGE_INSPECT"?{state:"ready",messageCount:4,conversationId:"claude:a"}:{ok:true,summary:{conversationId:"claude:a",messageCount:4}});
 Object.assign(chrome.tabs,{get,remove,create,sendMessage});return {tab,get,remove,create,sendMessage};
}
it("imports one rendered conversation at a time and closes only its own background tab",async()=>{
 const {create,remove}=importTab(),manager=createWebCaptureManager("reader.js");
 const pending=manager.importHistory("claude","https://claude.ai/chat/a","claude:a");
 await vi.advanceTimersByTimeAsync(2000);expect(await pending).toMatchObject({ok:true});expect(create).toHaveBeenCalledWith({url:"https://claude.ai/chat/a",active:false});expect(remove).toHaveBeenCalledExactlyOnceWith(88);
});
it("retains a temporary tab if the user activates it, rejects mismatched targets and reports save failure",async()=>{
 const {tab,remove,sendMessage}=importTab(),manager=createWebCaptureManager("reader.js");tab.active=true;
 await expect(manager.importHistory("claude","https://claude.ai/chat/b","claude:a")).rejects.toThrow("Invalid");
 sendMessage.mockImplementation(async(_id,message)=>message.type==="ATLAS_WEB_PAGE_INSPECT"?{state:"ready",messageCount:4,conversationId:"claude:a"}:{ok:false,error:"Save failed"});
 const outcome=manager.importHistory("claude",tab.url,"claude:a").catch(error=>error);
 await vi.advanceTimersByTimeAsync(2000);expect(await outcome).toMatchObject({message:"Save failed"});expect(remove).not.toHaveBeenCalled();
});
it("keeps a history tab the user visited even after they switch back before the import finishes",async()=>{
 const {tab,remove}=importTab(),added=vi.fn(),removed=vi.fn();Object.assign(chrome.tabs,{onActivated:{addListener:added,removeListener:removed}});
 const manager=createWebCaptureManager("reader.js"),pending=manager.importHistory("claude",tab.url,"claude:a");
 await vi.advanceTimersByTimeAsync(400);added.mock.calls[0][0]({tabId:88});await vi.advanceTimersByTimeAsync(2000);expect(await pending).toMatchObject({ok:true});expect(remove).not.toHaveBeenCalled();expect(removed).toHaveBeenCalledOnce();
});
it("stops an in-flight import on permission revocation and permits a later retry",async()=>{
 const {tab,remove}=importTab(),manager=createWebCaptureManager("reader.js");
 const outcome=manager.importHistory("claude",tab.url,"claude:a").catch(error=>error);
 await vi.advanceTimersByTimeAsync(400);grants.clear();await vi.advanceTimersByTimeAsync(400);
 expect((await outcome).message).toMatch(/revoked/u);expect(remove).toHaveBeenCalledOnce();
 grants.add("https://claude.ai/*");const retry=manager.importHistory("claude",tab.url,"claude:a");await vi.advanceTimersByTimeAsync(2000);expect(await retry).toMatchObject({ok:true});
});
it("times out unrecognized layouts without falsely completing an empty import",async()=>{
 const {tab,sendMessage}=importTab(),manager=createWebCaptureManager("reader.js");sendMessage.mockResolvedValue({state:"empty",messageCount:0,conversationId:"claude:a"});
 const outcome=manager.importHistory("claude",tab.url,"claude:a").catch(error=>error);await vi.advanceTimersByTimeAsync(17000);expect((await outcome).message).toMatch(/did not finish/u);
 expect(sendMessage.mock.calls.some(call=>call[1].type==="ATLAS_CAPTURE_NOW")).toBe(false);
});
