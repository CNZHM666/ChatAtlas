import {afterEach,expect,it,vi} from "vitest";
import {registerChatGPTEntryRecovery} from "./entry-recovery";
afterEach(()=>vi.unstubAllGlobals());
function setup(){
 const tabs={get:vi.fn().mockResolvedValue({id:42,url:"https://chatgpt.com/c/current"}),query:vi.fn().mockResolvedValue([{id:42}]),onActivated:{addListener:vi.fn(),removeListener:vi.fn()},onUpdated:{addListener:vi.fn(),removeListener:vi.fn()}};
 vi.stubGlobal("chrome",{tabs});
 const deps={ping:vi.fn().mockResolvedValue(false),inject:vi.fn().mockResolvedValue(undefined)};
 return {tabs,deps,recovery:registerChatGPTEntryRecovery(deps)};
}
it("repairs already-open AI pages after reload and reuses a working content entry",async()=>{
 const {tabs,deps,recovery}=setup();
 await recovery.repairOpenTabs();
 expect(tabs.query).toHaveBeenCalledExactlyOnceWith({url:"https://chatgpt.com/*"});
 expect(deps.inject).toHaveBeenCalledExactlyOnceWith(42);
 deps.ping.mockResolvedValue(true);await recovery.repairOpenTabs();
 expect(deps.inject).toHaveBeenCalledOnce();recovery.dispose();
});
it("deduplicates activation and completed-load recovery without injecting into a tab that navigated away",async()=>{
 const {tabs,deps,recovery}=setup();
 let finish!:(ready:boolean)=>void;deps.ping.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 tabs.onActivated.addListener.mock.calls[0][0]({tabId:42});
 tabs.onUpdated.addListener.mock.calls[0][0](42,{status:"complete"},{active:true,url:"https://chatgpt.com/c/current"});
 await vi.waitFor(()=>expect(deps.ping).toHaveBeenCalledOnce());
 tabs.get.mockResolvedValue({id:42,url:"https://example.com/"});finish(false);
 await vi.waitFor(()=>expect(tabs.get).toHaveBeenCalledTimes(2));expect(deps.inject).not.toHaveBeenCalled();
 recovery.dispose();
});
it("recovers from a failed injection on the next activation and stops after disposal",async()=>{
 const {tabs,deps,recovery}=setup();deps.inject.mockRejectedValueOnce(Error("page reloading"));
 await recovery.repairOpenTabs();await recovery.repairOpenTabs();expect(deps.inject).toHaveBeenCalledTimes(2);
 recovery.dispose();await recovery.repairOpenTabs();expect(deps.inject).toHaveBeenCalledTimes(2);
 expect(tabs.onActivated.removeListener).toHaveBeenCalledWith(tabs.onActivated.addListener.mock.calls[0][0]);
});
