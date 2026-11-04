import {useState} from "react";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {FocusFollowUp,type RevisionScope} from "./FocusFollowUp";
afterEach(cleanup);
it("selects individual chapters or all while protecting personal edits and keeping the request explicit",()=>{
 const submit=vi.fn();
 function Harness(){const[scope,onScope]=useState<RevisionScope>("section"),[selectedIds,onSelection]=useState<string[]>(["a"]),[instruction,onInstruction]=useState("统一当前方案");return <FocusFollowUp zh title="项目" currentId="a" chapters={[{id:"a",title:"产品介绍"},{id:"b",title:"架构"},{id:"c",title:"我的正文",disabled:true}]} {...{scope,onScope,selectedIds,onSelection,instruction,onInstruction}} onClose={vi.fn()} onSubmit={()=>submit({scope,selectedIds,instruction})}/>;}
 render(<Harness/>);expect(submit).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole("combobox",{name:"调整范围"}),{target:{value:"selected"}});
 expect(screen.getByRole("checkbox",{name:"产品介绍"})).toBeChecked();expect(screen.getByRole("checkbox",{name:/我的正文/})).toBeDisabled();
 fireEvent.click(screen.getByRole("button",{name:"清空"}));expect(screen.getByRole("button",{name:/生成修改预览/})).toBeDisabled();
 fireEvent.click(screen.getByRole("checkbox",{name:"架构"}));fireEvent.click(screen.getByRole("button",{name:/生成修改预览/}));
 expect(submit).toHaveBeenLastCalledWith({scope:"selected",selectedIds:["b"],instruction:"统一当前方案"});
 fireEvent.click(screen.getByRole("button",{name:"全选"}));expect(within(screen.getByRole("group",{name:"选择章节"})).getAllByRole("checkbox").filter(node=>(node as HTMLInputElement).checked)).toHaveLength(2);
 fireEvent.change(screen.getByRole("combobox",{name:"调整范围"}),{target:{value:"whole"}});expect(screen.queryByRole("checkbox")).toBeNull();expect(screen.getByRole("button",{name:/生成修改预览/})).toHaveTextContent("2");
 expect(submit).toHaveBeenCalledOnce();
});

it("lets Wiki readers request recommended revision without writing a prompt and makes extra requirements optional",()=>{
 const submit=vi.fn(),change=vi.fn();
 render(<FocusFollowUp zh title="项目" currentId="a" chapters={[{id:"a",title:"产品介绍"}]} scope="whole" instruction="" onInstruction={change} onScope={vi.fn()} onClose={vi.fn()} onSubmit={submit}/>);
 expect(screen.getByText("推荐整理")).toBeVisible();expect(screen.getByLabelText("补充要求").closest("details")).not.toHaveAttribute("open");
 fireEvent.click(screen.getByRole("button",{name:/生成修改预览/}));expect(submit).toHaveBeenCalledOnce();expect(change).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("补充要求（选填）"));expect(screen.getByRole("textbox",{name:"补充要求"})).toBeVisible();
});
