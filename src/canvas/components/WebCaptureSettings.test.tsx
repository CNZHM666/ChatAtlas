import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {WebCaptureSettings} from "./WebCaptureSettings";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("shows permission-granted platforms running automatically without requesting access or activation",async()=>{
 const request=vi.fn(),sendMessage=vi.fn().mockResolvedValue({ok:true,status:[{platform:"claude",enabled:true,permitted:true}]});
 vi.stubGlobal("chrome",{runtime:{id:"fixture",sendMessage},permissions:{request}});render(<WebCaptureSettings zh/>);
 const button=screen.getByRole("switch",{name:"Claude 自动采集"});await waitFor(()=>expect(button).toHaveAttribute("aria-checked","true"));expect(screen.getByText("自动采集")).toBeVisible();expect(request).not.toHaveBeenCalled();expect(sendMessage).toHaveBeenCalledExactlyOnceWith({type:"ATLAS_WEB_CAPTURE_STATUS"});
 expect(screen.queryByText("检测已打开的对话")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Claude 管理采集"}));expect(screen.getByText("检测已打开的对话")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Gemini 管理采集"}));expect(screen.queryByText("检测已打开的对话")).toBeNull();expect(screen.getByRole("button",{name:"Claude 管理采集"})).toHaveAttribute("aria-expanded","false");
});
it("requests only the chosen website from the click and enables capture after permission",async()=>{
 let enabled=false;const request=vi.fn().mockResolvedValue(true),sendMessage=vi.fn().mockImplementation(async message=>{if(message.type==="ATLAS_WEB_CAPTURE_SET")enabled=message.enabled;return {ok:true,status:[{platform:"claude",enabled,permitted:enabled}]};});
 vi.stubGlobal("chrome",{runtime:{id:"fixture",sendMessage},permissions:{request},storage:{onChanged:{addListener:vi.fn(),removeListener:vi.fn()}}});
 render(<WebCaptureSettings zh/>);const button=screen.getByRole("switch",{name:"Claude 自动采集"});await waitFor(()=>expect(button).toBeEnabled());
 expect(request).not.toHaveBeenCalled();fireEvent.click(button);await waitFor(()=>expect(button).toHaveAttribute("aria-checked","true"));expect(request).toHaveBeenCalledExactlyOnceWith({origins:["https://claude.ai/*"]});expect(sendMessage).toHaveBeenCalledWith({type:"ATLAS_WEB_CAPTURE_SET",platform:"claude",enabled:true});
 fireEvent.click(button);await waitFor(()=>expect(button).toHaveAttribute("aria-checked","false"));expect(request).toHaveBeenCalledOnce();
});
it("retains the disabled state when website permission is refused",async()=>{
 const sendMessage=vi.fn().mockResolvedValue({ok:true,status:[{platform:"claude",enabled:false,permitted:false}]}),request=vi.fn().mockResolvedValue(false);
 vi.stubGlobal("chrome",{runtime:{id:"fixture",sendMessage},permissions:{request}});const {rerender}=render(<WebCaptureSettings zh/>);
 const button=screen.getByRole("switch",{name:"Claude 自动采集"});await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);await screen.findByRole("alert");expect(button).toHaveAttribute("aria-checked","false");expect(sendMessage).toHaveBeenCalledTimes(1);
 rerender(<WebCaptureSettings zh={false}/>);expect(screen.getByRole("alert")).toHaveTextContent("Website access was not granted. Capture remains off.");
});
