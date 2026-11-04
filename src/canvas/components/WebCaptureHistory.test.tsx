import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {WebCaptureHistory} from "./WebCaptureHistory";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const tabs=[{tabId:3,title:"Website",url:"https://claude.ai/new",messageCount:0,state:"unsupported" as const}];
it("imports only selected entries, preserves successes and exposes failures for retry",async()=>{
 const sendMessage=vi.fn().mockImplementation(async message=>message.type==="ATLAS_WEB_HISTORY_LIST"?{ok:true,page:{scope:"loaded",entries:[{conversationId:"claude:a",title:"Chat A",url:"https://claude.ai/chat/a"},{conversationId:"claude:b",title:"Chat B",url:"https://claude.ai/chat/b"}]}}:{ok:false});
 vi.stubGlobal("chrome",{runtime:{sendMessage}});render(<WebCaptureHistory platform="claude" tabs={tabs} zh/>);
 fireEvent.click(screen.getByText(/读取历史标题/u));const first=await screen.findByRole("checkbox",{name:"Chat A"});fireEvent.click(first);
 fireEvent.click(screen.getByText("导入所选（1）"));await screen.findByText(/失败，可重试/u);expect(sendMessage).toHaveBeenLastCalledWith({type:"ATLAS_WEB_HISTORY_IMPORT",platform:"claude",url:"https://claude.ai/chat/a",conversationId:"claude:a"});
 sendMessage.mockResolvedValue({ok:true,summary:{conversationId:"claude:a",messageCount:2}});fireEvent.click(screen.getByText("导入所选（1）"));await screen.findByText(/已保存已加载内容/u);
 expect(screen.getByRole("checkbox",{name:"Chat B"})).not.toBeChecked();
});
it("stops remaining items after the current operation and does not invent an empty-account result",async()=>{
 let finish:((value:unknown)=>void)|undefined;
 const sendMessage=vi.fn().mockImplementation(async message=>message.type==="ATLAS_WEB_HISTORY_LIST"?{ok:true,page:{scope:"loaded",entries:[{conversationId:"claude:a",title:"Chat A",url:"https://claude.ai/chat/a"},{conversationId:"claude:b",title:"Chat B",url:"https://claude.ai/chat/b"}]}}:new Promise(resolve=>{finish=resolve;}));
 vi.stubGlobal("chrome",{runtime:{sendMessage}});render(<WebCaptureHistory platform="claude" tabs={tabs} zh/>);
 fireEvent.click(screen.getByText(/读取历史标题/u));fireEvent.click(await screen.findByRole("checkbox",{name:"Chat A"}));fireEvent.click(screen.getByRole("checkbox",{name:"Chat B"}));fireEvent.click(screen.getByText("导入所选（2）"));
 fireEvent.click(await screen.findByText("当前条目完成后停止"));finish?.({ok:true});await waitFor(()=>expect(screen.getByText("导入所选（2）")).toBeEnabled());expect(sendMessage.mock.calls.filter(call=>call[0].type==="ATLAS_WEB_HISTORY_IMPORT")).toHaveLength(1);
});

