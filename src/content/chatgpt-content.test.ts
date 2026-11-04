// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(()=>{window.dispatchEvent(new PageTransitionEvent("pagehide"));vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();document.getElementById("atlas-navigator-trigger-style")?.remove();});

it("makes the production loader re-execution and ping restore one working native entry",async()=>{
 vi.useFakeTimers();
 document.body.innerHTML='<header><button>分享</button></header><main></main>';
 window.history.replaceState({},"","/c/restored");
 const sendMessage=vi.fn(async()=>({ok:true})),listeners:Array<(message:{type:string},sender:unknown,reply:(value:unknown)=>void)=>unknown>=[];
 vi.stubGlobal("chrome",{runtime:{sendMessage,getURL:(path:string)=>`https://extension.example/${path}`,onMessage:{addListener:(listener:typeof listeners[number])=>listeners.push(listener)}},storage:{local:{get:vi.fn(async()=>({}))}}});
 const content=await import("./chatgpt-content");
 expect(typeof content.onExecute).toBe("function");expect(listeners).toHaveLength(1);
 window.dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));
 expect(document.querySelector(".atlas-navigator-trigger")).toBeNull();
 window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));
 content.onExecute();content.onExecute();
 expect(document.querySelectorAll(".atlas-navigator-trigger")).toHaveLength(1);expect(listeners).toHaveLength(1);
 document.querySelector(".atlas-navigator-trigger")!.remove();
 const reply=vi.fn();listeners[0]({type:"ATLAS_PING"},{},reply);
 expect(reply).toHaveBeenCalledWith(expect.objectContaining({ready:true}));
 const entry=document.querySelector<HTMLButtonElement>(".atlas-navigator-trigger")!;expect(entry).not.toBeNull();
 entry.click();await Promise.resolve();
 const calls=sendMessage.mock.calls.map(call=>(call as unknown as [{type:string}])[0].type);
 expect(calls).toEqual(["ATLAS_CONTENT_READY","ATLAS_OPEN_SIDEPANEL"]);
});
