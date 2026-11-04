import {afterEach,expect,it,vi} from "vitest";
import {webChatEntry} from "./web-chat-entry";
afterEach(()=>{document.body.innerHTML="";vi.unstubAllGlobals();});
it("keeps one automatic entry across repeated updates and opens the native panel",async()=>{
 const sendMessage=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal("chrome",{runtime:{sendMessage}});
 const first=webChatEntry();first.ensure();first.ensure();webChatEntry().ensure();expect(document.querySelectorAll('#atlas-web-chat-entry')).toHaveLength(1);
 document.getElementById('atlas-web-chat-entry')!.click();await Promise.resolve();expect(sendMessage).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_OPEN_SIDEPANEL"});first.remove();expect(document.getElementById('atlas-web-chat-entry')).toBeNull();
});
it("opens the workspace when the browser cannot open its native panel",async()=>{
 const sendMessage=vi.fn().mockResolvedValue({ok:false,unsupported:true});vi.stubGlobal("chrome",{runtime:{sendMessage}});webChatEntry().ensure();document.getElementById('atlas-web-chat-entry')!.click();await Promise.resolve();expect(sendMessage).toHaveBeenLastCalledWith({type:"ATLAS_OPEN"});
});
