import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {ReaderMoreMenu} from "./ReaderMoreMenu";
afterEach(cleanup);

it("opens and closes the delete options without running an action",()=>{
 const version=vi.fn(),project=vi.fn();
 render(<ReaderMoreMenu flat zh edits={[{label:"调整内容",run:vi.fn()}]} danger={[{label:"删除此版本",run:version},{label:"删除项目",run:project}]}/>);
 fireEvent.click(screen.getByText("更多"));
 const openDelete = screen.getByRole("button",{name:"删除选项"});
 expect(screen.queryByRole("button",{name:"删除此版本"})).not.toBeInTheDocument();
 fireEvent.click(openDelete);
 expect(openDelete).toHaveAttribute("aria-expanded","true");
 expect(screen.getByText("可在回收站恢复")).toBeVisible();
 expect(screen.getByRole("button",{name:"调整内容"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"返回 删除选项"})).not.toBeInTheDocument();
 fireEvent.keyDown(screen.getByRole("button",{name:"删除此版本"}),{key:"Escape"});
 expect(openDelete).toHaveFocus();
 expect(openDelete).toHaveAttribute("aria-expanded","false");
 fireEvent.click(openDelete);
 fireEvent.click(screen.getByRole("button",{name:"删除此版本"}));
 expect(version).toHaveBeenCalledOnce();expect(project).not.toHaveBeenCalled();
});
