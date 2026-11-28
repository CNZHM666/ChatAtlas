import {afterEach,expect,it,vi} from "vitest";
import {isNativePanelSite,openNativeSidePanel} from "./side-panel";
afterEach(()=>vi.unstubAllGlobals());
it("opens in the original gesture with the manifest's default panel",async()=>{
 let finish!:()=>void;
 const open=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),setOptions=vi.fn();
 vi.stubGlobal("chrome",{sidePanel:{open,setOptions}});
 const pending=openNativeSidePanel(42,"https://chat.deepseek.com/a/chat/s/one",7);
 expect(open).toHaveBeenCalledExactlyOnceWith({windowId:7});
 expect(setOptions).not.toHaveBeenCalled();
 finish();await expect(pending).resolves.toEqual({ok:true});
});
it("uses the caller tab without a window ID and refuses unrelated or extension URLs",async()=>{
 const open=vi.fn().mockResolvedValue(undefined);vi.stubGlobal("chrome",{sidePanel:{open}});
 expect(await openNativeSidePanel(42,"https://chatgpt.com/c/one")).toEqual({ok:true});
 expect(open).toHaveBeenCalledExactlyOnceWith({tabId:42});
 for(const url of ["https://example.com","chrome-extension://atlas/atlas.html","chrome://newtab","https://chatgpt.com.evil.test/","http://chatgpt.com"]){expect(await openNativeSidePanel(42,url)).toEqual({ok:false,unsupported:true});}
 expect(open).toHaveBeenCalledOnce();
 for(const url of ["https://chatgpt.com/","https://claude.ai/new","https://gemini.google.com/app"])expect(isNativePanelSite(url)).toBe(true);
 vi.stubGlobal("chrome",{});expect(await openNativeSidePanel(42,"https://chatgpt.com/")).toEqual({ok:false,unsupported:true});
});
