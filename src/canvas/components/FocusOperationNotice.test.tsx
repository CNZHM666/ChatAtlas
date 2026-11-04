import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {FocusOperationNotice} from "./FocusOperationNotice";
afterEach(cleanup);

it("keeps the contextual action and dismissal separate from expandable diagnostics",()=>{
  const action=vi.fn(),dismiss=vi.fn();
  render(<FocusOperationNotice zh title="本章材料较长，暂未调整" message="当前内容已保留，本章请求尚未发送。" action={{label:"重新选择章节",run:action}} onDismiss={dismiss}><details><summary>查看原因</summary><p>预计输入 12000 Token，上限 8000 Token。</p></details></FocusOperationNotice>);
  const notice=screen.getByRole("alert");
  expect(within(notice).queryByRole("button",{name:"重试生成"})).toBeNull();expect(within(notice).queryByRole("button",{name:"AI 设置"})).toBeNull();
  fireEvent.click(within(notice).getByText("查看原因"));expect(within(notice).getByText(/12000 Token/)).toBeVisible();
  fireEvent.click(within(notice).getByRole("button",{name:"重新选择章节"}));expect(action).toHaveBeenCalledOnce();
  fireEvent.click(within(notice).getByRole("button",{name:"关闭提示"}));expect(dismiss).toHaveBeenCalledOnce();
});
