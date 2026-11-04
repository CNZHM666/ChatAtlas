import "fake-indexeddb/auto";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,render,screen} from "@testing-library/react";
import {SidecarMemory} from "./SidecarMemory";
afterEach(cleanup);
it("keeps sidebar search without project-context or collection entry points",()=>{
 const changeView=vi.fn();render(<SidecarMemory conversations={[]} conversationId="unsaved" zh view="home" onView={changeView} onOpen={vi.fn()}/>);
 expect(screen.queryByRole("button",{name:"项目上下文"})).toBeNull();
 expect(screen.queryByRole("button",{name:"上下文收藏"})).toBeNull();
 expect(screen.getByRole("searchbox",{name:"搜索历史对话"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"问答"})).toBeNull();expect(screen.queryByRole("navigation",{name:"侧栏功能"})).toBeNull();expect(screen.queryByRole("button",{name:"AI 快速配置"})).toBeNull();
});
