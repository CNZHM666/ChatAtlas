import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {SidecarScopePicker} from "./SidecarScopePicker";
const conversation={id:"stored",title:"唯一的已导入对话",platform:"chatgpt",url:"https://chatgpt.com/c/stored",updatedAt:1,messageCount:2};
afterEach(cleanup);
it("allows selecting the only imported chat while viewing an unsaved chat",()=>{
 const choose=vi.fn();render(<SidecarScopePicker zh source="" conversationId="unsaved" conversations={[conversation]} hasProject={false} onChoose={choose} onClose={vi.fn()}/>);
 const option=screen.getByRole("option",{name:conversation.title});fireEvent.click(option);expect(choose).toHaveBeenCalledWith("stored");
 const all=screen.getByRole("option",{name:"全部已导入对话"});all.focus();fireEvent.keyDown(all,{key:"ArrowDown"});expect(option).toHaveFocus();fireEvent.keyDown(option,{key:"Home"});expect(all).toHaveFocus();
 fireEvent.change(screen.getByRole("searchbox",{name:"筛选对话"}),{target:{value:"不存在"}});expect(screen.queryByRole("option",{name:conversation.title})).toBeNull();expect(screen.getByText("没有匹配的对话")).toBeVisible();
});
