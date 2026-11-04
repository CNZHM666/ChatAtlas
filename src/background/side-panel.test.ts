import {afterEach,expect,it,vi} from "vitest";
import {isNativePanelSite,openNativeSidePanel,registerNativeSidePanels} from "./side-panel";
afterEach(()=>vi.unstubAllGlobals());
it("opens during the click stack even when panel configuration has not resolved",async()=>{
 let finish!:()=>void;const open=vi.fn(async()=>undefined),setOptions=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 vi.stubGlobal("chrome",{sidePanel:{open,setOptions}});const pending=openNativeSidePanel(42,"https://chatgpt.com/c/one");
 expect(open).toHaveBeenCalledExactlyOnceWith({tabId:42});finish();await expect(pending).resolves.toEqual({ok:true});
});
it("configures the shared panel before opening and refuses unrelated or extension URLs",async()=>{
 const open=vi.fn().mockResolvedValue(undefined),setOptions=vi.fn().mockResolvedValue(undefined);vi.stubGlobal("chrome",{sidePanel:{open,setOptions}});
 expect(await openNativeSidePanel(42,"https://chatgpt.com/c/one")).toEqual({ok:true});
 expect(setOptions).toHaveBeenCalledExactlyOnceWith({path:"sidecar.html?native=1",enabled:true});
 expect(open).toHaveBeenCalledExactlyOnceWith({tabId:42});
 expect(setOptions.mock.invocationCallOrder[0]).toBeLessThan(open.mock.invocationCallOrder[0]);
 for(const url of ["https://example.com","chrome-extension://atlas/atlas.html","chrome://newtab","https://chatgpt.com.evil.test/","http://chatgpt.com"]){expect(await openNativeSidePanel(42,url)).toEqual({ok:false,unsupported:true});}
 expect(open).toHaveBeenCalledOnce();
 for(const url of ["https://chatgpt.com/","https://claude.ai/new","https://gemini.google.com/app"])expect(isNativePanelSite(url)).toBe(true);
 vi.stubGlobal("chrome",{});expect(await openNativeSidePanel(42,"https://chatgpt.com/")).toEqual({ok:false,unsupported:true});
});
it("keeps the global panel enabled without changing visibility on activation, reload or worker restart",async()=>{
 const setOptions=vi.fn().mockResolvedValue(undefined),open=vi.fn();
 const updated={addListener:vi.fn(),removeListener:vi.fn()},activated={addListener:vi.fn(),removeListener:vi.fn()};
 vi.stubGlobal("chrome",{sidePanel:{setOptions,open},tabs:{onUpdated:updated,onActivated:activated}});
 registerNativeSidePanels();registerNativeSidePanels();
 expect(setOptions).toHaveBeenCalledTimes(2);
 for(const [options] of setOptions.mock.calls)expect(options).toEqual({path:"sidecar.html?native=1",enabled:true});
 expect(activated.addListener).not.toHaveBeenCalled();expect(updated.addListener).not.toHaveBeenCalled();
 expect(open).not.toHaveBeenCalled();
});
it("opens the shared panel in the caller window during the original gesture",async()=>{
 const open=vi.fn().mockResolvedValue(undefined),setOptions=vi.fn().mockResolvedValue(undefined);
 vi.stubGlobal("chrome",{sidePanel:{open,setOptions}});
 await expect(openNativeSidePanel(42,"https://chatgpt.com/c/current",7)).resolves.toEqual({ok:true});
 expect(open).toHaveBeenCalledExactlyOnceWith({windowId:7});
 expect(setOptions).toHaveBeenCalledExactlyOnceWith({path:"sidecar.html?native=1",enabled:true});
});
