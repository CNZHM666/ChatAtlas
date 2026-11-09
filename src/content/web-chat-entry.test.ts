import {afterEach,expect,it,vi} from "vitest";
import {webChatEntry} from "./web-chat-entry";
afterEach(()=>{document.body.innerHTML="";vi.unstubAllGlobals();});
it("keeps one automatic entry across repeated updates and opens the native panel",async()=>{
 const sendMessage=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal("chrome",{runtime:{sendMessage,getURL:(path:string)=>`chrome-extension://atlas/${path}`}});
 const first=webChatEntry();first.ensure();first.ensure();webChatEntry().ensure();expect(document.querySelectorAll('#atlas-web-chat-entry')).toHaveLength(1);
 document.getElementById('atlas-web-chat-entry')!.click();await Promise.resolve();expect(sendMessage).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_OPEN_SIDEPANEL"});first.remove();expect(document.getElementById('atlas-web-chat-entry')).toBeNull();
});
it("opens the workspace when the browser cannot open its native panel",async()=>{
 const sendMessage=vi.fn().mockResolvedValue({ok:false,unsupported:true});vi.stubGlobal("chrome",{runtime:{sendMessage,getURL:(path:string)=>`chrome-extension://atlas/${path}`}});webChatEntry().ensure();document.getElementById('atlas-web-chat-entry')!.click();await Promise.resolve();expect(sendMessage).toHaveBeenLastCalledWith({type:"ATLAS_OPEN"});
});
it("shows the brand logo and name, as the ChatGPT button does at the page edge",()=>{
 vi.stubGlobal("chrome",{runtime:{sendMessage:vi.fn(),getURL:(path:string)=>`chrome-extension://atlas/${path}`}});webChatEntry().ensure();
 const button=document.getElementById('atlas-web-chat-entry')!;
 expect(button.className).toBe("atlas-navigator-trigger atlas-navigator-trigger--edge");
 expect(button.querySelector(".atlas-trigger-mark img")?.getAttribute("src")).toMatch(/^(?:chrome-extension:\/\/atlas\/|data:image\/)/u);
 expect(button.querySelector(".atlas-trigger-label")?.textContent).toBe("ChatAtlas");
 expect(document.getElementById("atlas-navigator-trigger-style")).not.toBeNull();
});
