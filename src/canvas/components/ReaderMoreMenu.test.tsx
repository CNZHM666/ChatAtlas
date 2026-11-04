import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {ReaderMoreMenu} from "./ReaderMoreMenu";
afterEach(cleanup);

it("keeps delete actions in their own last section and runs the chosen one",()=>{
 const version=vi.fn(),project=vi.fn();
 render(<ReaderMoreMenu flat zh edits={[{label:"调整内容",run:vi.fn()}]} danger={[{label:"删除此版本",run:version},{label:"删除项目",run:project}]}/>);
 fireEvent.click(screen.getByText("更多"));
 expect(screen.getByText("删除（可在回收站恢复）")).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"删除此版本"}));
 expect(version).toHaveBeenCalledOnce();expect(project).not.toHaveBeenCalled();
});
