import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {WebCaptureTabs} from "./WebCaptureTabs";
import type {AtlasMessage} from "../../shared/messages";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("shows per-tab readiness and only reports a save after persistence acknowledges it",async()=>{
 const sendMessage=vi.fn().mockImplementation(async message=>message.type==="ATLAS_WEB_CAPTURE_TABS"?{ok:true,tabs:[{tabId:3,title:"Kimi discussion",url:"https://kimi.com/chat/id",conversationId:"kimi:id",messageCount:4,state:"ready"},{tabId:4,title:"Still replying",url:"https://kimi.com/chat/next",conversationId:"kimi:next",messageCount:2,state:"streaming"}]}:{ok:true,summary:{conversationId:"kimi:id",messageCount:4}});
 vi.stubGlobal("chrome",{runtime:{sendMessage}});render(<WebCaptureTabs platform="kimi" zh/>);
 fireEvent.click(screen.getByText("检测已打开的对话"));await screen.findByText("Kimi discussion",{selector:"strong"});
 expect(screen.getAllByText("保存当前已加载内容")).toHaveLength(1);
 fireEvent.click(screen.getByText("保存当前已加载内容"));await screen.findByText("已保存 4 条");
 expect(sendMessage).toHaveBeenLastCalledWith({type:"ATLAS_WEB_CAPTURE_TAB",platform:"kimi",tabId:3,conversationId:"kimi:id"});
});
it("keeps failed saves retryable and does not claim success",async()=>{
 vi.stubGlobal("chrome",{runtime:{sendMessage:async(message:AtlasMessage)=>message.type==="ATLAS_WEB_CAPTURE_TABS"?{ok:true,tabs:[{tabId:3,title:"Discussion",url:"https://kimi.com/chat/id",conversationId:"kimi:id",messageCount:2,state:"ready"}]}:{ok:false,error:"Navigated"}}});
 render(<WebCaptureTabs platform="kimi" zh/>);fireEvent.click(screen.getByText("检测已打开的对话"));fireEvent.click(await screen.findByText("保存当前已加载内容"));await screen.findByRole("alert");expect(screen.queryByRole("status")).toBeNull();expect(screen.getByText("保存当前已加载内容")).toBeEnabled();
});
