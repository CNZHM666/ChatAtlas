import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectWikiNavigation } from "./ProjectWikiNavigation";
import { projectSession } from "../../test/project-fixture";
import { useState } from "react";
import { saveRouteCard } from "../focus-route";

afterEach(()=>{cleanup();localStorage.removeItem("atlas-wiki-categories:project-fixture");});
it("expands subtopics inside one main chapter and navigates to its real heading",()=>{
 const session=projectSession(),read=vi.fn();session.sections=[{...session.sections[0],title:"系统架构",body:"当前说明。\n\n## 数据存储\n\n原始消息留在本地。\n\n## 消息检索\n\n返回消息级结果。\n\n```md\n## 不是导航\n```"}];
 render(<ProjectWikiNavigation session={session} zh onRead={read}/>);
 expect(screen.getByRole("button",{name:"1 系统架构"})).toBeVisible();expect(screen.queryByText("子主题")).toBeNull();fireEvent.click(screen.getByRole("button",{name:"展开系统架构的子主题"}));expect(read).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"消息检索"}));expect(read).toHaveBeenCalledWith(session.sections[0].id,"消息检索");expect(screen.queryByRole("button",{name:"不是导航"})).toBeNull();expect(session.sections).toHaveLength(1);
 fireEvent.click(screen.getByRole("button",{name:"收起系统架构的子主题"}));expect(screen.queryByRole("button",{name:"消息检索"})).toBeNull();expect(read).toHaveBeenCalledTimes(1);
});
const fixture = () => {
  const session = projectSession();
  session.sections = [
    { ...session.sections[0], id: "one", title: "架构定义", wikiGroup: "技术架构" },
    { ...session.sections[0], id: "two", title: "发布条件", body: "验证后才能发布", wikiGroup: "产品设计" },
    { ...session.sections[0], id: "three", title: "用户流程", wikiGroup: "产品设计" },
  ];
  return session;
};

it("edits labels and group locally and moves a page without changing source chronology", async () => {
  const session = fixture(), onEdit = vi.fn().mockResolvedValue(undefined), onMove = vi.fn().mockResolvedValue(undefined);
  render(<ProjectWikiNavigation session={session} zh onRead={vi.fn()} adjusting onEdit={onEdit} onMove={onMove} />);
  expect(screen.queryByRole("button",{name:"合并重复章节"})).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "修改 发布条件" }));
  fireEvent.change(screen.getByLabelText("标题"), { target: { value: "首轮发布" } });
  fireEvent.change(screen.getByLabelText("分组"), { target: { value: "验证计划" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(screen.queryByLabelText("标题")).not.toBeInTheDocument());
  expect(onEdit).toHaveBeenCalledWith("two", "首轮发布", "验证计划", "");
  fireEvent.click(screen.getByRole("button", { name: "下移 发布条件" }));
  await waitFor(() => expect(onMove).toHaveBeenCalledWith(["one", "three", "two"]));
  expect(session.sections.map(section => section.id)).toEqual(["one", "two", "three"]);
});

it("uses one stable page number across groups instead of restarting each group", () => {
  render(<ProjectWikiNavigation session={fixture()} zh onRead={vi.fn()} adjusting />);
  expect(screen.getByRole("button", { name: "1 架构定义" })).toBeVisible();
  expect(screen.getByRole("button", { name: "2 发布条件" })).toBeVisible();
  expect(screen.getByRole("button", { name: "3 用户流程" })).toBeVisible();
  expect(screen.getByRole("button", { name: "3 用户流程" })).toBeVisible();
});

it("adds a real chapter from the bottom without directory adjustment and keeps failed drafts",async()=>{
 const original=fixture(),create=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("created"),read=vi.fn();
 function Harness(){const[session,setSession]=useState(original);return <ProjectWikiNavigation session={session} zh onRead={read} onCreatePage={async(title,body,group)=>{const id=await create(title,body,group);setSession({...session,sections:saveRouteCard(session.sections,{id,title,body,transition:""}).map(item=>item.id===id?{...item,wikiGroup:group,wikiGroupEdited:true}:item)});return id;}}/>;}
 const{container}=render(<Harness/>);expect(container.querySelector(".wiki-create-page")?.previousElementSibling).toHaveClass("wiki-directory-group");
 fireEvent.click(screen.getByRole("button",{name:"新增章节"}));fireEvent.change(screen.getByLabelText("章节标题"),{target:{value:"个人验证记录"}});fireEvent.change(screen.getByLabelText("章节内容（可选）"),{target:{value:"只验证预览，实物测试待完成。"}});
 fireEvent.click(screen.getByRole("button",{name:"创建"}));await screen.findByRole("alert");expect(screen.getByLabelText("章节标题")).toHaveValue("个人验证记录");
 fireEvent.click(screen.getByRole("button",{name:"创建"}));await waitFor(()=>expect(screen.queryByLabelText("章节标题")).toBeNull());expect(create).toHaveBeenLastCalledWith("个人验证记录","只验证预览，实物测试待完成。",expect.anything());expect(read).toHaveBeenCalledWith("created");
 expect(screen.getByRole("button",{name:/个人验证记录/})).toBeVisible();expect(container.querySelector(".wiki-group-toggle")).toBeNull();expect(original.sections).toHaveLength(3);
});
it("shows every chapter in saved order without group folding, and keeps original metadata on edit",()=>{
 const session=fixture();session.wikiOrder=["three","one","two"];const edit=vi.fn();
 render(<ProjectWikiNavigation session={session} zh adjusting onRead={vi.fn()} onEdit={edit}/>);
 expect(screen.getAllByRole("button",{name:/^\d /}).map(node=>node.textContent)).toEqual(["1用户流程","2架构定义","3发布条件"]);
 fireEvent.click(screen.getByRole("button",{name:"修改 发布条件"}));expect(screen.getByLabelText("分组")).toHaveValue("产品设计");
});


